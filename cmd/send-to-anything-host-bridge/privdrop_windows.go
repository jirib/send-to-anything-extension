//go:build windows

package main

import (
	"os"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	hostJob    windows.Handle
	jobMu      sync.Mutex
	activeJobs = make(map[int]windows.Handle)
)

// initPrivdrop configures a Windows Job Object with KILL_ON_JOB_CLOSE for the host process.
// If the browser or host bridge process terminates, all spawned child processes are cleanly killed.
func initPrivdrop() error {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return err
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
		return err
	}

	// Try assigning host process to this job so child processes inherit it
	_ = windows.AssignProcessToJobObject(job, windows.CurrentProcess())
	hostJob = job
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

// afterProcessStart associates a newly spawned process with a Job Object to ensure
// clean lifecycle termination and group-kill capabilities on timeout.
func afterProcessStart(pid int) {
	if pid <= 0 {
		return
	}

	// First, if hostJob is available, assign child to hostJob for global cleanup on exit
	if hostJob != 0 {
		if hProcess, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(pid)); err == nil {
			_ = windows.AssignProcessToJobObject(hostJob, hProcess)
			_ = windows.CloseHandle(hProcess)
		}
	}

	// Also create a dedicated Job Object for this command so killProcessGroup can kill its entire tree
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
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
		return
	}

	hProcess, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(pid))
	if err != nil {
		_ = windows.CloseHandle(job)
		return
	}
	defer windows.CloseHandle(hProcess)

	if err := windows.AssignProcessToJobObject(job, hProcess); err != nil {
		_ = windows.CloseHandle(job)
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
