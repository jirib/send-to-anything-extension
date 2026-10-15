//go:build !windows

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

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
			return nil, fmt.Errorf("unsupported browser '%s' on macOS (supported: chromium, chrome, brave, edge, all)", browser)
		}

	default:
		return nil, fmt.Errorf("automatic manifest registration not supported on %s", runtime.GOOS)
	}

	return dirs, nil
}

func getExistingAllowedOrigins(browser string) []string {
	dirs, err := GetHostTargetDirs(browser)
	if err != nil {
		return nil
	}
	for _, dir := range dirs {
		for _, candidate := range []string{HostName, LegacyHostName} {
			candidatePath := filepath.Join(dir, candidate+".json")
			if data, err := os.ReadFile(candidatePath); err == nil {
				var existing HostManifest
				if err := json.Unmarshal(data, &existing); err == nil && len(existing.AllowedOrigins) > 0 {
					var origins []string
					for _, orig := range existing.AllowedOrigins {
						if !strings.Contains(orig, "YOUR_EXTENSION_ID_HERE") {
							origins = append(origins, orig)
						}
					}
					if len(origins) > 0 {
						return origins
					}
				}
			}
		}
	}
	return nil
}

func installPlatform(browser string, manifest HostManifest, manifestData []byte) error {
	dirs, err := GetHostTargetDirs(browser)
	if err != nil {
		return err
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

func uninstallPlatform(browser string) error {
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
