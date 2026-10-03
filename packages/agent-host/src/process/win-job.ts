/**
 * Windows Job Objects for agent process trees (security-model R7), with no native dependency:
 * kernel32 is called through `bun:ffi`, which is built into the Bun runtime and into `bun build
 * --compile` binaries (it loads the system DLL by name, nothing is bundled). Under Node (tests, dev)
 * `bun:ffi` does not exist and the caller keeps using `taskkill /T` with the start-time check.
 *
 * A job is created per agent process right after spawn and the process is assigned to it; every
 * process it starts afterwards joins the job automatically, even when its parent has exited (which
 * `taskkill /T` cannot see). Stopping a session terminates the whole job.
 * The job sets no limits, in particular not JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: agents are told to start
 * dev servers in the background, and those must survive a normal end of the session. Children spawned in the few
 * milliseconds between spawn and assignment are not in the job (taskkill /T still covers them).
 */

export interface JobHandle {
  /** Terminates every process in the job. */
  terminate(): boolean;
  /** Releases the handle (processes keep running). */
  close(): void;
}

export interface JobApi {
  /** Creates a job and assigns `pid` to it; null when the process cannot be opened or assigned. */
  attach(pid: number): JobHandle | null;
}

/** The subset of `bun:ffi` this module uses (injectable for tests). */
export interface FfiLike {
  dlopen(
    lib: string,
    symbols: Record<string, { args: unknown[]; returns: unknown }>,
  ): { symbols: Record<string, (...args: unknown[]) => unknown>; close(): void };
  FFIType: Record<string, unknown>;
}

const PROCESS_TERMINATE = 0x0001;
const PROCESS_SET_QUOTA = 0x0100;
const isNull = (h: unknown): boolean => h === null || h === undefined || h === 0 || h === 0n;

export function createJobApi(ffi: FfiLike): JobApi {
  const T = ffi.FFIType;
  const k = ffi.dlopen('kernel32.dll', {
    CreateJobObjectW: { args: [T.ptr, T.ptr], returns: T.ptr },
    OpenProcess: { args: [T.u32, T.i32, T.u32], returns: T.ptr },
    AssignProcessToJobObject: { args: [T.ptr, T.ptr], returns: T.i32 },
    TerminateJobObject: { args: [T.ptr, T.u32], returns: T.i32 },
    CloseHandle: { args: [T.ptr], returns: T.i32 },
  }).symbols;
  return {
    attach(pid) {
      if (!Number.isSafeInteger(pid) || pid <= 0) return null;
      const job = k.CreateJobObjectW?.(null, null);
      if (isNull(job)) return null;
      const proc = k.OpenProcess?.(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
      if (isNull(proc)) {
        k.CloseHandle?.(job);
        return null;
      }
      const assigned = k.AssignProcessToJobObject?.(job, proc) !== 0;
      k.CloseHandle?.(proc);
      if (!assigned) {
        k.CloseHandle?.(job);
        return null;
      }
      let open = true;
      return {
        terminate: () => (open ? k.TerminateJobObject?.(job, 1) !== 0 : false),
        close: () => {
          if (!open) return;
          open = false;
          k.CloseHandle?.(job);
        },
      };
    },
  };
}

/**
 * Loads the Job Object API when running on Windows under Bun; null otherwise (Node, macOS, Linux,
 * or if kernel32 cannot be bound). The specifier is computed so bundlers never try to resolve it.
 */
export async function loadWindowsJobApi(platform: NodeJS.Platform = process.platform): Promise<JobApi | null> {
  if (platform !== 'win32' || !process.versions.bun) return null;
  try {
    const spec = ['bun', 'ffi'].join(':');
    const ffi = (await import(spec)) as FfiLike;
    return createJobApi(ffi);
  } catch {
    return null;
  }
}
