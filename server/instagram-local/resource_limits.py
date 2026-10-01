"""Native limits apply only to the PCS relay process, never system services."""
import ctypes
from ctypes import wintypes
import os

_jobs = []


def setup_cpu_limit():
    if os.name != "nt":
        raise RuntimeError("cpu_limit_unavailable")
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    handle = wintypes.HANDLE
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = handle
    kernel.GetCurrentProcess.restype = handle
    kernel.SetInformationJobObject.argtypes = [handle, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.QueryInformationJobObject.argtypes = [handle, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p]
    kernel.AssignProcessToJobObject.argtypes = [handle, handle]
    kernel.IsProcessInJob.argtypes = [handle, handle, ctypes.POINTER(wintypes.BOOL)]
    kernel.SetPriorityClass.argtypes = [handle, wintypes.DWORD]
    kernel.SetProcessAffinityMask.argtypes = [handle, ctypes.c_size_t]
    kernel.CloseHandle.argtypes = [handle]

    class CpuRate(ctypes.Structure):
        _fields_ = [("ControlFlags", wintypes.DWORD), ("CpuRate", wintypes.DWORD)]

    job = kernel.CreateJobObjectW(None, None)
    if not job:
        raise RuntimeError("cpu_limit_unavailable")
    control, verified = CpuRate(0x1 | 0x4, 1000), CpuRate()
    process = kernel.GetCurrentProcess()
    assigned = wintypes.BOOL()
    ok = (kernel.SetInformationJobObject(job, 15, ctypes.byref(control), ctypes.sizeof(control))
          and kernel.QueryInformationJobObject(job, 15, ctypes.byref(verified), ctypes.sizeof(verified), None)
          and verified.ControlFlags == 5 and verified.CpuRate == 1000
          and kernel.AssignProcessToJobObject(job, process)
          and kernel.IsProcessInJob(process, job, ctypes.byref(assigned)) and assigned.value
          and kernel.SetPriorityClass(process, 0x40) and kernel.SetProcessAffinityMask(process, 1))
    if not ok:
        kernel.CloseHandle(job)
        raise RuntimeError("cpu_limit_unavailable")
    _jobs.append(job)
    return {"cpu_limit_percent": verified.CpuRate / 100, "assigned": bool(assigned.value)}
