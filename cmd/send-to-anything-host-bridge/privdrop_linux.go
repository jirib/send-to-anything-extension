//go:build linux

package main

import (
	"errors"
	"fmt"
	"syscall"

	"golang.org/x/sys/unix"
)

// initPrivdrop applies process-wide privilege escalation prevention on Linux.
// It sets PR_SET_NO_NEW_PRIVS across all Go runtime OS threads,
// ensuring no child processes can ever gain privileges (via setuid/setgid or file capabilities).
func initPrivdrop() error {
	_, _, err := syscall.AllThreadsSyscall(syscall.SYS_PRCTL, unix.PR_SET_NO_NEW_PRIVS, 1, 0)
	if err != 0 {
		if errors.Is(err, syscall.ENOTSUP) {
			return fmt.Errorf("PR_SET_NO_NEW_PRIVS via AllThreadsSyscall is not supported in cgo-enabled binaries (compile with CGO_ENABLED=0): %w", err)
		}
		return fmt.Errorf("failed to set PR_SET_NO_NEW_PRIVS: %w", err)
	}
	return nil
}

// prepareSysProcAttr configures Linux process attributes:
// - Setpgid: creates a new process group so child processes can be cleanly reaped
// - Pdeathsig: sends SIGKILL to the child process immediately if the parent host dies
func prepareSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{
		Setpgid:   true,
		Pdeathsig: syscall.SIGKILL,
	}
}

// killProcessGroup terminates an entire process group.
func killProcessGroup(pid int) {
	if pid > 0 {
		_ = syscall.Kill(-pid, syscall.SIGKILL)
	}
}

// afterProcessStart is a no-op hook on Linux (Pdeathsig & Setpgid handle lifecycle).
func afterProcessStart(pid int) {}

// afterProcessDone is a no-op hook on Linux.
func afterProcessDone(pid int) {}
