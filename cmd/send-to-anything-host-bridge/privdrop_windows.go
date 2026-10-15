//go:build windows

package main

import (
	"os"
	"syscall"
)

// initPrivdrop is a no-op on Windows.
func initPrivdrop() error {
	return nil
}

// prepareSysProcAttr configures Windows process attributes.
func prepareSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{}
}

// killProcessGroup terminates the process on Windows.
func killProcessGroup(pid int) {
	if pid > 0 {
		if proc, err := os.FindProcess(pid); err == nil {
			_ = proc.Kill()
		}
	}
}
