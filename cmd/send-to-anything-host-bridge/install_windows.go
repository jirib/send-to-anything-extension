//go:build windows

package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows/registry"
)

// getWindowsManifestDir returns the folder where the host manifest JSON is stored on Windows.
func getWindowsManifestDir() (string, error) {
	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("could not determine user home directory: %w", err)
		}
		localAppData = filepath.Join(home, "AppData", "Local")
	}
	return filepath.Join(localAppData, "SendToAnything"), nil
}

// GetHostTargetDirs returns candidate directory paths on Windows.
func GetHostTargetDirs(browser string) ([]string, error) {
	dir, err := getWindowsManifestDir()
	if err != nil {
		return nil, err
	}
	return []string{dir}, nil
}

// getWindowsRegistryBaseKeys returns the base registry paths for the specified browser(s).
func getWindowsRegistryBaseKeys(browser string) ([]string, error) {
	b := strings.ToLower(strings.TrimSpace(browser))
	if b == "" {
		b = "chromium"
	}

	keyMap := map[string]string{
		"chrome":   `Software\Google\Chrome\NativeMessagingHosts`,
		"chromium": `Software\Chromium\NativeMessagingHosts`,
		"edge":     `Software\Microsoft\Edge\NativeMessagingHosts`,
		"brave":    `Software\BraveSoftware\Brave-Browser\NativeMessagingHosts`,
	}

	if b == "all" {
		var keys []string
		for _, k := range []string{"chrome", "chromium", "edge", "brave"} {
			keys = append(keys, keyMap[k])
		}
		return keys, nil
	}

	if k, exists := keyMap[b]; exists {
		return []string{k}, nil
	}

	return nil, fmt.Errorf("unsupported browser '%s' on Windows (supported: chrome, chromium, edge, brave, all)", browser)
}

func getExistingAllowedOrigins(browser string) []string {
	dir, err := getWindowsManifestDir()
	if err != nil {
		return nil
	}
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
	return nil
}

func installPlatform(browser string, manifest HostManifest, manifestData []byte) error {
	dir, err := getWindowsManifestDir()
	if err != nil {
		return err
	}

	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create manifest directory '%s': %w", dir, err)
	}

	// Clean up legacy JSON manifest if present
	legacyFile := filepath.Join(dir, LegacyHostName+".json")
	if _, err := os.Stat(legacyFile); err == nil {
		_ = os.Remove(legacyFile)
	}

	destPath := filepath.Join(dir, HostName+".json")
	if err := os.WriteFile(destPath, manifestData, 0644); err != nil {
		return fmt.Errorf("failed to write manifest to '%s': %w", destPath, err)
	}
	fmt.Printf("✓ Created Native Messaging Host manifest at: %s\n", destPath)

	baseKeys, err := getWindowsRegistryBaseKeys(browser)
	if err != nil {
		return err
	}

	for _, baseKey := range baseKeys {
		// Clean up legacy registry key if present
		legacySubKey := baseKey + `\` + LegacyHostName
		_ = registry.DeleteKey(registry.CURRENT_USER, legacySubKey)

		// Create/open target registry key
		subKey := baseKey + `\` + HostName
		k, _, err := registry.CreateKey(registry.CURRENT_USER, subKey, registry.SET_VALUE)
		if err != nil {
			return fmt.Errorf("failed to create registry key 'HKCU\\%s': %w", subKey, err)
		}

		// Set the Default value to the manifest path
		if err := k.SetStringValue("", destPath); err != nil {
			k.Close()
			return fmt.Errorf("failed to set registry value for 'HKCU\\%s': %w", subKey, err)
		}
		k.Close()
		fmt.Printf("✓ Registered Native Messaging Host in Registry: HKCU\\%s\n", subKey)
	}

	return nil
}

func uninstallPlatform(browser string) error {
	baseKeys, err := getWindowsRegistryBaseKeys(browser)
	if err != nil {
		return err
	}

	for _, baseKey := range baseKeys {
		for _, name := range []string{HostName, LegacyHostName} {
			subKey := baseKey + `\` + name
			err := registry.DeleteKey(registry.CURRENT_USER, subKey)
			if err == nil {
				fmt.Printf("✓ Removed Registry key: HKCU\\%s\n", subKey)
			} else if !errors.Is(err, registry.ErrNotExist) {
				fmt.Fprintf(os.Stderr, "Notice: could not delete HKCU\\%s: %v\n", subKey, err)
			}
		}
	}

	// Clean up manifest files
	if dir, err := getWindowsManifestDir(); err == nil {
		for _, name := range []string{HostName, LegacyHostName} {
			filePath := filepath.Join(dir, name+".json")
			if _, err := os.Stat(filePath); err == nil {
				if err := os.Remove(filePath); err == nil {
					fmt.Printf("✓ Removed manifest file: %s\n", filePath)
				}
			}
		}
		// Attempt to remove directory if empty
		_ = os.Remove(dir)
	}

	return nil
}
