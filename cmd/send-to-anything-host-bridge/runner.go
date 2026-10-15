package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	DefaultTimeout = 30 * time.Second
	MaxTimeout     = 300 * time.Second
	MaxOutputBytes = 10 * 1024 * 1024 // 10MB safety cap on captured output
)

func init() {
	// Initialize enriched PATH immediately so LookPath can find user-installed CLI tools
	// even when Chromium is launched without an interactive login shell environment.
	_ = os.Setenv("PATH", buildEnrichedPath())
}

// buildEnrichedPath merges standard user binary directories (such as ~/.local/share/mise/shims,
// ~/.local/bin, ~/bin, ~/.cargo/bin) with the existing process PATH to ensure tools are discoverable.
func buildEnrichedPath() string {
	home, err := os.UserHomeDir()
	var candidates []string
	if err == nil {
		candidates = append(candidates,
			filepath.Join(home, ".local", "share", "mise", "shims"),
			filepath.Join(home, ".local", "bin"),
			filepath.Join(home, "bin"),
			filepath.Join(home, ".cargo", "bin"),
			filepath.Join(home, "go", "bin"),
		)
	}

	existing := os.Getenv("PATH")
	existingParts := filepath.SplitList(existing)

	var allDirs []string
	seen := make(map[string]bool)

	// Add candidates if they exist on disk
	for _, dir := range candidates {
		if !seen[dir] {
			if info, err := os.Stat(dir); err == nil && info.IsDir() {
				allDirs = append(allDirs, dir)
				seen[dir] = true
			}
		}
	}

	// Add existing PATH entries
	for _, dir := range existingParts {
		if dir != "" && !seen[dir] {
			allDirs = append(allDirs, dir)
			seen[dir] = true
		}
	}

	// Ensure basic system directories are present
	systemDirs := []string{"/usr/local/bin", "/usr/bin", "/bin", "/usr/local/sbin", "/usr/sbin", "/sbin"}
	for _, dir := range systemDirs {
		if !seen[dir] {
			allDirs = append(allDirs, dir)
			seen[dir] = true
		}
	}

	return strings.Join(allDirs, string(filepath.ListSeparator))
}

// expandPath expands leading ~ to user's home directory.
func expandPath(path string) string {
	if strings.HasPrefix(path, "~/") || path == "~" {
		if home, err := os.UserHomeDir(); err == nil {
			if path == "~" {
				return home
			}
			return filepath.Join(home, path[2:])
		}
	}
	return path
}

// SplitCommandLine splits a command line string into the executable binary
// and its arguments, preserving single and double-quoted tokens, without invoking a shell.
func SplitCommandLine(commandLine string) (string, []string, error) {
	var tokens []string
	var current strings.Builder
	inSingle := false
	inDouble := false
	escaped := false

	trimmed := strings.TrimSpace(commandLine)
	if trimmed == "" {
		return "", nil, errors.New("empty command line")
	}

	for i := 0; i < len(trimmed); i++ {
		ch := trimmed[i]

		if escaped {
			current.WriteByte(ch)
			escaped = false
			continue
		}

		if ch == '\\' && !inSingle {
			escaped = true
			continue
		}

		if ch == '\'' && !inDouble {
			inSingle = !inSingle
			continue
		}

		if ch == '"' && !inSingle {
			inDouble = !inDouble
			continue
		}

		if (ch == ' ' || ch == '\t') && !inSingle && !inDouble {
			if current.Len() > 0 {
				tokens = append(tokens, current.String())
				current.Reset()
			}
			continue
		}

		current.WriteByte(ch)
	}

	if inSingle || inDouble {
		return "", nil, errors.New("unclosed quote in command line")
	}

	if current.Len() > 0 {
		tokens = append(tokens, current.String())
	}

	if len(tokens) == 0 {
		return "", nil, errors.New("no executable found in command line")
	}

	return tokens[0], tokens[1:], nil
}

// ExecuteCommand executes the requested command with safety bounds,
// privilege dropping attributes, timeout enforcement, and input delivery.
func ExecuteCommand(ctx context.Context, req *Request) *Response {
	if strings.TrimSpace(req.Command) == "" {
		return &Response{
			Error:    "empty command specified",
			ExitCode: 1,
		}
	}

	var binaryPath string
	var baseArgs []string

	if len(req.Args) == 0 {
		bin, parsedArgs, err := SplitCommandLine(req.Command)
		if err != nil {
			return &Response{
				Error:    fmt.Sprintf("invalid command syntax: %v", err),
				ExitCode: 1,
			}
		}
		binaryPath = bin
		baseArgs = parsedArgs
	} else {
		binaryPath = strings.TrimSpace(req.Command)
		baseArgs = req.Args
	}

	binaryPath = expandPath(binaryPath)

	timeout := DefaultTimeout
	if req.TimeoutSeconds > 0 {
		timeout = time.Duration(req.TimeoutSeconds) * time.Second
		if timeout > MaxTimeout {
			timeout = MaxTimeout
		}
	}

	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	// Prepare arguments and placeholder substitutions
	hasTextPlaceholder := false
	hasPromptPlaceholder := false
	var finalArgs []string

	for _, arg := range baseArgs {
		newArg := arg
		if strings.Contains(newArg, "%%actual_text%%") {
			newArg = strings.ReplaceAll(newArg, "%%actual_text%%", req.Text)
			hasTextPlaceholder = true
		}
		if strings.Contains(newArg, "{{text}}") {
			newArg = strings.ReplaceAll(newArg, "{{text}}", req.Text)
			hasTextPlaceholder = true
		}
		if strings.Contains(newArg, "{{prompt}}") {
			newArg = strings.ReplaceAll(newArg, "{{prompt}}", req.Prompt)
			hasPromptPlaceholder = true
		}
		finalArgs = append(finalArgs, newArg)
	}

	mode := strings.ToLower(strings.TrimSpace(req.InputMode))
	if mode == "" {
		mode = "stdin"
	}

	// If argument mode is chosen but {{text}} wasn't in args, append text
	if (mode == "arg" || mode == "argument") && !hasTextPlaceholder && req.Text != "" {
		finalArgs = append(finalArgs, req.Text)
	}

	// Normalize arguments for CLI tools like Gemini that reject positional arguments alongside --prompt
	finalArgs = normalizeArgs(binaryPath, finalArgs)

	// Build process command
	cmd := exec.CommandContext(cmdCtx, binaryPath, finalArgs...)
	cmd.SysProcAttr = prepareSysProcAttr()
	cmd.Env = sanitizeEnvironment()

	// Set up Stdin
	var stdinPipe io.WriteCloser
	shouldPipeStdin := (mode == "stdin" || mode == "both")
	if shouldPipeStdin {
		var err error
		stdinPipe, err = cmd.StdinPipe()
		if err != nil {
			return &Response{
				Error:    fmt.Sprintf("failed to create stdin pipe: %v", err),
				ExitCode: 1,
			}
		}
	}

	// Capture stdout and stderr with size limit
	var stdoutBuf bytes.Buffer
	var stderrBuf bytes.Buffer
	cmd.Stdout = &limitedWriter{w: &stdoutBuf, remaining: MaxOutputBytes}
	cmd.Stderr = &limitedWriter{w: &stderrBuf, remaining: MaxOutputBytes}

	if err := cmd.Start(); err != nil {
		return &Response{
			Error:    fmt.Sprintf("failed to start command '%s': %v", binaryPath, err),
			ExitCode: 127,
		}
	}

	// Write to stdin in background if applicable
	if shouldPipeStdin && stdinPipe != nil {
		go func() {
			defer stdinPipe.Close()
			payload := req.Text
			if req.Prompt != "" && !hasPromptPlaceholder {
				if strings.Contains(req.Prompt, "%%actual_text%%") {
					payload = strings.ReplaceAll(req.Prompt, "%%actual_text%%", req.Text)
				} else if strings.Contains(req.Prompt, "{{text}}") {
					payload = strings.ReplaceAll(req.Prompt, "{{text}}", req.Text)
				} else if payload != "" {
					payload = req.Prompt + "\n\n" + payload
				} else {
					payload = req.Prompt
				}
			}
			_, _ = io.WriteString(stdinPipe, payload)
		}()
	}

	if req.FireAndForget {
		return &Response{
			Output:   "Command spawned successfully (one-way)",
			ExitCode: 0,
		}
	}

	// Monitor completion or timeout cancellation
	done := make(chan error, 1)
	go func() {
		done <- cmd.Wait()
	}()

	var waitErr error
	select {
	case <-cmdCtx.Done():
		if cmd.Process != nil {
			killProcessGroup(cmd.Process.Pid)
		}
		waitErr = cmdCtx.Err()
	case waitErr = <-done:
	}

	resp := &Response{
		Output: stdoutBuf.String(),
	}

	if waitErr != nil {
		if errors.Is(waitErr, context.DeadlineExceeded) {
			resp.Error = fmt.Sprintf("command timed out after %v", timeout)
			resp.ExitCode = 124
		} else if exitErr, ok := waitErr.(*exec.ExitError); ok {
			resp.ExitCode = exitErr.ExitCode()
			errOutput := strings.TrimSpace(stderrBuf.String())
			if errOutput != "" {
				resp.Error = errOutput
			} else {
				resp.Error = exitErr.Error()
			}
		} else {
			resp.Error = waitErr.Error()
			resp.ExitCode = 1
		}
	} else {
		errOutput := strings.TrimSpace(stderrBuf.String())
		if errOutput != "" {
			resp.Error = errOutput
		}
	}

	return resp
}

// normalizeArgs handles CLI quirks where prompt flags like --prompt or -p
// should capture all following words until the next flag, preventing tools like
// Gemini CLI from reporting "Cannot use both a positional prompt and --prompt".
func normalizeArgs(binaryPath string, args []string) []string {
	baseName := strings.ToLower(filepath.Base(binaryPath))
	if !strings.Contains(baseName, "gemini") {
		return args
	}

	var result []string
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if (arg == "--prompt" || arg == "-p") && i+1 < len(args) {
			result = append(result, arg)
			i++
			var promptWords []string
			for ; i < len(args); i++ {
				if strings.HasPrefix(args[i], "-") {
					i--
					break
				}
				promptWords = append(promptWords, args[i])
			}
			result = append(result, strings.Join(promptWords, " "))
			continue
		}
		result = append(result, arg)
	}
	return result
}

// sanitizeEnvironment retains safe, standard environment variables
// plus standard AI / CLI API keys while omitting arbitrary dangerous variables.
func sanitizeEnvironment() []string {
	safeKeys := map[string]bool{
		"HOME":              true,
		"USER":              true,
		"LANG":              true,
		"LC_ALL":            true,
		"SHELL":             true,
		"TERM":              true,
		"XDG_CONFIG_HOME":   true,
		"XDG_DATA_HOME":     true,
		"XDG_CACHE_HOME":    true,
		"XDG_RUNTIME_DIR":   true,
		"GEMINI_API_KEY":    true,
		"OPENAI_API_KEY":    true,
		"ANTHROPIC_API_KEY": true,
		"OLLAMA_HOST":       true,
	}

	var env []string
	env = append(env, "PATH="+buildEnrichedPath())

	for _, entry := range os.Environ() {
		parts := strings.SplitN(entry, "=", 2)
		if len(parts) == 2 && safeKeys[parts[0]] {
			env = append(env, entry)
		}
	}
	return env
}

// limitedWriter prevents runaway memory usage by capping written bytes.
type limitedWriter struct {
	w         io.Writer
	remaining int
}

func (l *limitedWriter) Write(p []byte) (n int, err error) {
	if l.remaining <= 0 {
		return len(p), nil // drop extra bytes silently
	}
	if len(p) > l.remaining {
		p = p[:l.remaining]
	}
	n, err = l.w.Write(p)
	l.remaining -= n
	return n, err
}
