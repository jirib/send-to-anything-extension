//go:build windows

package main

import (
	"fmt"
	"os"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	jobMu      sync.Mutex
	activeJobs = make(map[int]windows.Handle)
)

// initPrivdrop is a no-op at host startup on Windows.
// Sandboxing and lifecycle constraints (KILL_ON_JOB_CLOSE) are applied per spawned command.
func initPrivdrop() error {
	return nil
}

// prepareSysProcAttr configures Windows process attributes:
// - HideWindow + CREATE_NO_WINDOW: prevents flashing black console/command prompt windows
// - CREATE_NEW_PROCESS_GROUP: isolates process group from parent console events
func prepareSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: windows.CREATE_NO_WINDOW | windows.CREATE_NEW_PROCESS_GROUP,
	}
}

// afterProcessStart associates a newly spawned process with a dedicated Job Object.
// Setting JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE ensures:
// 1. If the host bridge terminates (e.g. browser closes or crashes), Windows automatically
//    terminates the child process and any descendants when the job handle closes.
// 2. On command timeout, TerminateJobObject terminates the entire process tree.
func afterProcessStart(pid int) {
	if pid <= 0 {
		return
	}

	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Warning: failed to create Windows Job Object for process %d: %v\n", pid, err)
		return
	}

	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{
		BasicLimitInformation: windows.JOBOBJECT_BASIC_LIMIT_INFORMATION{
			LimitFlags: windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
		},
	}

	_, err = windows.SetInformationJobObject(
		job,
		windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)),
		uint32(unsafe.Sizeof(info)),
	)
	if err != nil {
		_ = windows.CloseHandle(job)
		fmt.Fprintf(os.Stderr, "Warning: failed to set Job Object limits for process %d: %v\n", pid, err)
		return
	}

	hProcess, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(pid))
	if err != nil {
		_ = windows.CloseHandle(job)
		fmt.Fprintf(os.Stderr, "Warning: failed to open process %d for Job Object assignment: %v\n", pid, err)
		return
	}
	defer windows.CloseHandle(hProcess)

	if err := windows.AssignProcessToJobObject(job, hProcess); err != nil {
		_ = windows.CloseHandle(job)
		fmt.Fprintf(os.Stderr, "Warning: failed to assign process %d to Job Object: %v\n", pid, err)
		return
	}

	jobMu.Lock()
	activeJobs[pid] = job
	jobMu.Unlock()
}

// afterProcessDone cleans up the dedicated Job Object handle for a completed command.
func afterProcessDone(pid int) {
	if pid <= 0 {
		return
	}

	jobMu.Lock()
	job, ok := activeJobs[pid]
	if ok {
		delete(activeJobs, pid)
	}
	jobMu.Unlock()

	if ok && job != 0 {
		_ = windows.CloseHandle(job)
	}
}

// killProcessGroup terminates the entire process tree of a command using its Job Object.
func killProcessGroup(pid int) {
	if pid <= 0 {
		return
	}

	jobMu.Lock()
	job, ok := activeJobs[pid]
	if ok {
		delete(activeJobs, pid)
	}
	jobMu.Unlock()

	if ok && job != 0 {
		_ = windows.TerminateJobObject(job, 1)
		_ = windows.CloseHandle(job)
	}

	// Direct process termination fallback
	if proc, err := os.FindProcess(pid); err == nil {
		_ = proc.Kill()
	}
}
