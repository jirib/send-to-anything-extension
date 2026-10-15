//go:build !linux && !openbsd && !windows

package main

import (
	"os"
	"syscall"
)

// initPrivdrop is a no-op fallback on platforms without explicit pledge/prctl.
func initPrivdrop() error {
	return nil
}

// prepareSysProcAttr configures portable process attributes.
func prepareSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{
		Setpgid: true,
	}
}

// killProcessGroup terminates the process group or process on other platforms.
func killProcessGroup(pid int) {
	if pid > 0 {
		if proc, err := os.FindProcess(pid); err == nil {
			_ = proc.Kill()
		}
	}
}

// afterProcessStart is a no-op hook on other platforms.
func afterProcessStart(pid int) {}

// afterProcessDone is a no-op hook on other platforms.
func afterProcessDone(pid int) {}
