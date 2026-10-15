package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const (
	HostName        = "com.send.to.anything"
	LegacyHostName  = "com.gemini.cli.bridge"
	HostDescription = "Send-to-anything Native Messaging Host"
)

type HostManifest struct {
	Name           string   `json:"name"`
	Description    string   `json:"description"`
	Path           string   `json:"path"`
	Type           string   `json:"type"`
	AllowedOrigins []string `json:"allowed_origins"`
}

// ResolveExecutablePath determines the canonical absolute path of the send-to-anything-host-bridge binary.
// If binaryPath is empty, it uses the executing binary's path (os.Executable).
func ResolveExecutablePath(binaryPath string) (string, error) {
	if binaryPath == "" {
		exe, err := os.Executable()
		if err != nil {
			return "", fmt.Errorf("could not determine executing binary path: %w", err)
		}
		binaryPath = exe
	} else if !filepath.IsAbs(binaryPath) && !strings.Contains(binaryPath, string(filepath.Separator)) {
		// If binaryPath is just a name like "send-to-anything-host-bridge", look it up in PATH
		if lp, err := exec.LookPath(binaryPath); err == nil {
			binaryPath = lp
		}
	}

	absBin, err := filepath.Abs(binaryPath)
	if err != nil {
		return "", fmt.Errorf("failed to resolve absolute binary path: %w", err)
	}

	if resolved, err := filepath.EvalSymlinks(absBin); err == nil {
		absBin = resolved
	}

	// If invoked via 'go run', the executable is a temporary build artifact.
	// Look up send-to-anything-host-bridge in PATH first, then check bin/
	if strings.Contains(absBin, "go-build") {
		if lp, err := exec.LookPath("send-to-anything-host-bridge"); err == nil {
			if resolved, err := filepath.EvalSymlinks(lp); err == nil {
				absBin = resolved
			} else {
				absBin = lp
			}
		} else {
			for _, name := range []string{"send-to-anything-host-bridge", "text-proxy-host"} {
				if fallback, err := filepath.Abs(filepath.Join("bin", name)); err == nil {
					if fi, err := os.Stat(fallback); err == nil && !fi.IsDir() {
						absBin = fallback
						break
					}
				}
			}
		}
	}

	// Verify binary exists
	if _, err := os.Stat(absBin); err != nil {
		return "", fmt.Errorf("binary not found at '%s' (please build or install send-to-anything-host-bridge first): %w", absBin, err)
	}

	return absBin, nil
}

// InstallManifest registers the Native Messaging manifest for the given browser and extension IDs.
func InstallManifest(browser, binaryPath string, extensionIDs []string) error {
	absBin, err := ResolveExecutablePath(binaryPath)
	if err != nil {
		return err
	}

	// Prepare allowed origins
	var allowedOrigins []string
	for _, id := range extensionIDs {
		trimmed := strings.TrimSpace(id)
		if trimmed != "" {
			if !strings.HasPrefix(trimmed, "chrome-extension://") {
				trimmed = fmt.Sprintf("chrome-extension://%s/", strings.Trim(trimmed, "/"))
			}
			allowedOrigins = append(allowedOrigins, trimmed)
		}
	}

	// If no extension IDs provided, try preserving existing allowed_origins
	if len(allowedOrigins) == 0 {
		allowedOrigins = getExistingAllowedOrigins(browser)
	}

	if len(allowedOrigins) == 0 {
		// Provide a placeholder so it can be updated
		allowedOrigins = []string{"chrome-extension://YOUR_EXTENSION_ID_HERE/"}
	}

	manifest := HostManifest{
		Name:           HostName,
		Description:    HostDescription,
		Path:           absBin,
		Type:           "stdio",
		AllowedOrigins: allowedOrigins,
	}

	manifestData, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal manifest json: %w", err)
	}

	return installPlatform(browser, manifest, manifestData)
}

// UninstallManifest removes registered manifest files and registry entries.
func UninstallManifest(browser string) error {
	return uninstallPlatform(browser)
}
