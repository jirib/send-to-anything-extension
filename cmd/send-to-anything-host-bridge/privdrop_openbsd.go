//go:build openbsd

package main

import (
	"syscall"

	"golang.org/x/sys/unix"
)

// initPrivdrop applies OpenBSD pledge to the host bridge process.
// Uses PledgePromises so execpromises remains NULL, allowing child processes
// spawned via execve to run unpledged with standard capabilities.
func initPrivdrop() error {
	return unix.PledgePromises("stdio rpath proc exec")
}

// prepareSysProcAttr configures OpenBSD process attributes.
func prepareSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{
		Setpgid: true,
	}
}

// killProcessGroup terminates an entire process group.
func killProcessGroup(pid int) {
	if pid > 0 {
		_ = syscall.Kill(-pid, syscall.SIGKILL)
	}
}

// afterProcessStart is a no-op hook on OpenBSD.
func afterProcessStart(pid int) {}

// afterProcessDone is a no-op hook on OpenBSD.
func afterProcessDone(pid int) {}
