package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
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

// GetHostTargetDirs returns candidate NativeMessagingHosts directory paths for the specified browser(s).
func GetHostTargetDirs(browser string) ([]string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("could not determine user home directory: %w", err)
	}

	b := strings.ToLower(strings.TrimSpace(browser))
	if b == "" {
		b = "chromium"
	}

	var dirs []string
	switch runtime.GOOS {
	case "linux", "openbsd", "freebsd":
		dirMap := map[string]string{
			"chromium": filepath.Join(home, ".config", "chromium", "NativeMessagingHosts"),
			"chrome":   filepath.Join(home, ".config", "google-chrome", "NativeMessagingHosts"),
			"brave":    filepath.Join(home, ".config", "BraveSoftware", "Brave-Browser", "NativeMessagingHosts"),
			"edge":     filepath.Join(home, ".config", "microsoft-edge", "NativeMessagingHosts"),
		}
		if b == "all" {
			for _, d := range dirMap {
				dirs = append(dirs, d)
			}
		} else if d, exists := dirMap[b]; exists {
			dirs = append(dirs, d)
		} else {
			return nil, fmt.Errorf("unsupported browser '%s' on %s (supported: chromium, chrome, brave, edge, all)", browser, runtime.GOOS)
		}

	case "darwin":
		dirMap := map[string]string{
			"chromium": filepath.Join(home, "Library", "Application Support", "Chromium", "NativeMessagingHosts"),
			"chrome":   filepath.Join(home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts"),
			"brave":    filepath.Join(home, "Library", "Application Support", "BraveSoftware", "Brave-Browser", "NativeMessagingHosts"),
			"edge":     filepath.Join(home, "Library", "Application Support", "Microsoft Edge", "NativeMessagingHosts"),
		}
		if b == "all" {
			for _, d := range dirMap {
				dirs = append(dirs, d)
			}
		} else if d, exists := dirMap[b]; exists {
			dirs = append(dirs, d)
		} else {
			return nil, fmt.Errorf("unsupported browser '%s' on macOS", browser)
		}

	default:
		return nil, fmt.Errorf("automatic manifest registration not supported on %s", runtime.GOOS)
	}

	return dirs, nil
}

// InstallManifest registers the Native Messaging manifest for the given browser and extension IDs.
func InstallManifest(browser, binaryPath string, extensionIDs []string) error {
	absBin, err := ResolveExecutablePath(binaryPath)
	if err != nil {
		return err
	}

	dirs, err := GetHostTargetDirs(browser)
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

	// If no extension IDs provided, try preserving existing allowed_origins from existing manifest
	if len(allowedOrigins) == 0 {
		for _, dir := range dirs {
			for _, candidate := range []string{HostName, LegacyHostName} {
				candidatePath := filepath.Join(dir, candidate+".json")
				if data, err := os.ReadFile(candidatePath); err == nil {
					var existing HostManifest
					if err := json.Unmarshal(data, &existing); err == nil && len(existing.AllowedOrigins) > 0 {
						for _, orig := range existing.AllowedOrigins {
							if !strings.Contains(orig, "YOUR_EXTENSION_ID_HERE") {
								allowedOrigins = append(allowedOrigins, orig)
							}
						}
					}
				}
				if len(allowedOrigins) > 0 {
					break
				}
			}
			if len(allowedOrigins) > 0 {
				break
			}
		}
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

	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("failed to create directory %s: %w", dir, err)
		}

		// Clean up legacy manifest if present
		legacyPath := filepath.Join(dir, LegacyHostName+".json")
		if _, err := os.Stat(legacyPath); err == nil {
			_ = os.Remove(legacyPath)
		}

		destPath := filepath.Join(dir, HostName+".json")
		if err := os.WriteFile(destPath, manifestData, 0644); err != nil {
			return fmt.Errorf("failed to write manifest to %s: %w", destPath, err)
		}
		fmt.Printf("✓ Registered Native Messaging Host at: %s\n", destPath)
	}

	return nil
}

// UninstallManifest removes registered manifest files.
func UninstallManifest(browser string) error {
	dirs, err := GetHostTargetDirs(browser)
	if err != nil {
		return err
	}

	for _, dir := range dirs {
		for _, name := range []string{HostName, LegacyHostName} {
			manifestPath := filepath.Join(dir, name+".json")
			if _, err := os.Stat(manifestPath); err == nil {
				if err := os.Remove(manifestPath); err != nil {
					return fmt.Errorf("failed to remove %s: %w", manifestPath, err)
				}
				fmt.Printf("✓ Removed Native Messaging Host manifest from: %s\n", manifestPath)
			}
		}
	}
	return nil
}
