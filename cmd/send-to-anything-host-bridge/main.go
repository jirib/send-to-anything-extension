package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
)

var Version = "1.0.0"

func main() {
	installFlag := flag.Bool("install", false, "Register the native messaging host manifest with browser(s)")
	uninstallFlag := flag.Bool("uninstall", false, "Remove the native messaging host manifest from browser(s)")
	browserFlag := flag.String("browser", "chromium", "Target browser (chromium, chrome, brave, edge, all)")
	extIDFlag := flag.String("extension-id", "", "Chrome extension ID(s) to allow (comma-separated)")
	binPathFlag := flag.String("binary-path", "", "Path to the host executable (defaults to absolute path of executing binary)")
	versionFlag := flag.Bool("version", false, "Print version and exit")

	// Direct CLI test flags
	testCmdFlag := flag.String("test-cmd", "", "Run a test command directly (for debugging without Chrome)")
	testTextFlag := flag.String("test-text", "", "Input text for the test command")
	testModeFlag := flag.String("test-mode", "stdin", "Input mode for test (stdin or arg)")

	flag.Parse()

	if *versionFlag {
		fmt.Printf("send-to-anything-host-bridge v%s\n", Version)
		return
	}

	if *installFlag {
		var ids []string
		if *extIDFlag != "" {
			for _, id := range strings.Split(*extIDFlag, ",") {
				ids = append(ids, strings.TrimSpace(id))
			}
		}

		if err := InstallManifest(*browserFlag, *binPathFlag, ids); err != nil {
			fmt.Fprintf(os.Stderr, "Error installing manifest: %v\n", err)
			os.Exit(1)
		}
		return
	}

	if *uninstallFlag {
		if err := UninstallManifest(*browserFlag); err != nil {
			fmt.Fprintf(os.Stderr, "Error uninstalling manifest: %v\n", err)
			os.Exit(1)
		}
		return
	}

	// Initialize privilege dropping and sandboxing across runtime OS threads
	if err := initPrivdrop(); err != nil {
		fmt.Fprintf(os.Stderr, "Warning: failed to initialize sandboxing: %v\n", err)
	}

	if *testCmdFlag != "" {
		req := &Request{
			Command:   *testCmdFlag,
			InputMode: *testModeFlag,
			Text:      *testTextFlag,
		}
		resp := ExecuteCommand(context.Background(), req)
		if resp.Error != "" {
			fmt.Fprintf(os.Stderr, "Command Error (Exit %d): %s\n", resp.ExitCode, resp.Error)
		}
		fmt.Print(resp.Output)
		os.Exit(resp.ExitCode)
	}

	// Native Messaging Mode (invoked by Chromium over Stdio)

	for {
		req, err := ReadMessage(os.Stdin)
		if err != nil {
			if err == io.EOF || err == io.ErrUnexpectedEOF {
				// Clean exit when Chrome closes pipe
				os.Exit(0)
			}
			// Attempt to write an error response if possible
			_ = WriteMessage(os.Stdout, &Response{
				Error:    fmt.Sprintf("Failed to parse request: %v", err),
				ExitCode: 1,
			})
			os.Exit(1)
		}

		resp := ExecuteCommand(context.Background(), req)
		if err := WriteMessage(os.Stdout, resp); err != nil {
			fmt.Fprintf(os.Stderr, "Failed to write response: %v\n", err)
			os.Exit(1)
		}
	}
}
