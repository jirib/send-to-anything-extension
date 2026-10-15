package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestNormalizeArgs(t *testing.T) {
	unquoted := []string{"--prompt", "Rewrite", "concisely", "and", "professionally:"}
	normalized := normalizeArgs("gemini", unquoted)
	expected := []string{"--prompt", "Rewrite concisely and professionally:"}
	if !reflect.DeepEqual(normalized, expected) {
		t.Errorf("Expected %v, got %v", expected, normalized)
	}

	withExtraFlags := []string{"--prompt", "Summarize", "this", "--model", "gemini-2.0-flash"}
	normalizedExtra := normalizeArgs("/path/to/gemini", withExtraFlags)
	expectedExtra := []string{"--prompt", "Summarize this", "--model", "gemini-2.0-flash"}
	if !reflect.DeepEqual(normalizedExtra, expectedExtra) {
		t.Errorf("Expected %v, got %v", expectedExtra, normalizedExtra)
	}
}

func TestBuildEnrichedPath(t *testing.T) {
	enriched := buildEnrichedPath()
	if !strings.Contains(enriched, "/usr/bin") {
		t.Errorf("Expected /usr/bin in enriched PATH, got: %s", enriched)
	}
}

func TestExpandPath(t *testing.T) {
	expanded := expandPath("~/testfile")
	if strings.HasPrefix(expanded, "~") {
		t.Errorf("Expected ~ to be expanded, got: %s", expanded)
	}
}

func TestSplitCommandLine(t *testing.T) {
	tests := []struct {
		input       string
		expectedBin string
		expectedArg []string
		expectErr   bool
	}{
		{
			input:       "tr a-z A-Z",
			expectedBin: "tr",
			expectedArg: []string{"a-z", "A-Z"},
		},
		{
			input:       "gemini --prompt \"Summarize in 3 points\" --json",
			expectedBin: "gemini",
			expectedArg: []string{"--prompt", "Summarize in 3 points", "--json"},
		},
		{
			input:       "sh -c 'echo \"hello world\"'",
			expectedBin: "sh",
			expectedArg: []string{"-c", "echo \"hello world\""},
		},
		{
			input:       "   /usr/bin/python3   script.py  arg1   ",
			expectedBin: "/usr/bin/python3",
			expectedArg: []string{"script.py", "arg1"},
		},
		{
			input:     "echo \"unclosed quote",
			expectErr: true,
		},
		{
			input:     "   ",
			expectErr: true,
		},
	}

	for _, tc := range tests {
		bin, args, err := SplitCommandLine(tc.input)
		if tc.expectErr {
			if err == nil {
				t.Errorf("Expected error for '%s', got nil", tc.input)
			}
			continue
		}
		if err != nil {
			t.Errorf("Unexpected error for '%s': %v", tc.input, err)
			continue
		}
		if bin != tc.expectedBin {
			t.Errorf("For '%s': expected bin '%s', got '%s'", tc.input, tc.expectedBin, bin)
		}
		if !reflect.DeepEqual(args, tc.expectedArg) {
			t.Errorf("For '%s': expected args %v, got %v", tc.input, tc.expectedArg, args)
		}
	}
}

func TestReadWriteMessageRoundtrip(t *testing.T) {
	resp := &Response{
		Output:   "Hello from test",
		Error:    "",
		ExitCode: 0,
	}

	var buf bytes.Buffer
	if err := WriteMessage(&buf, resp); err != nil {
		t.Fatalf("WriteMessage failed: %v", err)
	}

	// Verify length header
	var length uint32
	if err := binary.Read(bytes.NewReader(buf.Bytes()[:4]), binary.LittleEndian, &length); err != nil {
		t.Fatalf("Failed to read header: %v", err)
	}
	if int(length) != buf.Len()-4 {
		t.Errorf("Header length %d mismatch with payload length %d", length, buf.Len()-4)
	}

	// Test reading a Request
	reqData := `{"command":"cat","args":["-n"],"input_mode":"stdin","text":"line1\nline2"}`
	var reqBuf bytes.Buffer
	reqLen := uint32(len(reqData))
	_ = binary.Write(&reqBuf, binary.LittleEndian, reqLen)
	reqBuf.WriteString(reqData)

	req, err := ReadMessage(&reqBuf)
	if err != nil {
		t.Fatalf("ReadMessage failed: %v", err)
	}
	if req.Command != "cat" {
		t.Errorf("Expected command 'cat', got '%s'", req.Command)
	}
	if req.Text != "line1\nline2" {
		t.Errorf("Unexpected text: %s", req.Text)
	}
}

func TestReadMessageExceedsLimit(t *testing.T) {
	var buf bytes.Buffer
	oversized := uint32(MaxMessageSize + 10)
	_ = binary.Write(&buf, binary.LittleEndian, oversized)

	_, err := ReadMessage(&buf)
	if err == nil {
		t.Fatal("Expected error for oversized message, got nil")
	}
	if !strings.Contains(err.Error(), "exceeds max allowed size") {
		t.Errorf("Unexpected error message: %v", err)
	}
}

func TestExecuteCommand_Stdin(t *testing.T) {
	req := &Request{
		Command:   "tr a-z A-Z",
		InputMode: "stdin",
		Text:      "hello world",
	}

	resp := ExecuteCommand(context.Background(), req)
	if resp.ExitCode != 0 {
		t.Fatalf("Expected exit code 0, got %d (err: %s)", resp.ExitCode, resp.Error)
	}
	if strings.TrimSpace(resp.Output) != "HELLO WORLD" {
		t.Errorf("Expected 'HELLO WORLD', got '%s'", resp.Output)
	}
}

func TestExecuteCommand_ArgsInterpolation(t *testing.T) {
	req := &Request{
		Command:   "echo Prefix: {{prompt}} - {{text}}",
		InputMode: "arg",
		Prompt:    "TestPrompt",
		Text:      "TestText",
	}

	resp := ExecuteCommand(context.Background(), req)
	if resp.ExitCode != 0 {
		t.Fatalf("Expected exit code 0, got %d (err: %s)", resp.ExitCode, resp.Error)
	}
	expected := "Prefix: TestPrompt - TestText"
	if strings.TrimSpace(resp.Output) != expected {
		t.Errorf("Expected '%s', got '%s'", expected, resp.Output)
	}
}

func TestExecuteCommand_ActualTextPlaceholder(t *testing.T) {
	req := &Request{
		Command:   "echo 'Input: %%actual_text%%'",
		InputMode: "arg",
		Text:      "VerifiedText",
	}

	resp := ExecuteCommand(context.Background(), req)
	if resp.ExitCode != 0 {
		t.Fatalf("Expected exit code 0, got %d (err: %s)", resp.ExitCode, resp.Error)
	}
	expected := "Input: VerifiedText"
	if strings.TrimSpace(resp.Output) != expected {
		t.Errorf("Expected '%s', got '%s'", expected, resp.Output)
	}
}

func TestExecuteCommand_FireAndForget(t *testing.T) {
	req := &Request{
		Command:       "sleep 5",
		FireAndForget: true,
	}
	start := time.Now()
	resp := ExecuteCommand(context.Background(), req)
	elapsed := time.Since(start)

	if resp.ExitCode != 0 {
		t.Errorf("Expected exit code 0, got %d", resp.ExitCode)
	}
	if elapsed > 1*time.Second {
		t.Errorf("Expected instant return for fire-and-forget, took %v", elapsed)
	}
}

func TestExecuteCommand_Timeout(t *testing.T) {
	req := &Request{
		Command:        "sleep 3",
		TimeoutSeconds: 1,
	}

	start := time.Now()
	resp := ExecuteCommand(context.Background(), req)
	elapsed := time.Since(start)

	if resp.ExitCode != 124 {
		t.Errorf("Expected exit code 124 for timeout, got %d", resp.ExitCode)
	}
	if !strings.Contains(resp.Error, "timed out") {
		t.Errorf("Expected timeout error message, got: %s", resp.Error)
	}
	if elapsed > 2*time.Second {
		t.Errorf("Timeout took too long: %v", elapsed)
	}
}

func TestExecuteCommand_NotFound(t *testing.T) {
	req := &Request{
		Command: "non_existent_binary_xyz123",
	}

	resp := ExecuteCommand(context.Background(), req)
	if resp.ExitCode != 127 {
		t.Errorf("Expected exit code 127 for not found, got %d", resp.ExitCode)
	}
	if resp.Error == "" {
		t.Error("Expected error message for non-existent binary")
	}
}

func TestGetHostTargetDirs(t *testing.T) {
	dirs, err := GetHostTargetDirs("chromium")
	if err != nil {
		t.Fatalf("GetHostTargetDirs failed: %v", err)
	}
	if len(dirs) != 1 {
		t.Fatalf("Expected 1 dir, got %d", len(dirs))
	}
	if !strings.Contains(dirs[0], "chromium") {
		t.Errorf("Expected chromium in path, got: %s", dirs[0])
	}
}
