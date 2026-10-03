/**
 * Process safety (security-model R7).
 * - Agent CLIs are spawned in their own process group on Unix (`detached: true`), so the whole tree can
 *   be signalled with `kill(-pid)`. On Windows the tree is killed with `taskkill /T /F /PID <pid>`.
 * - Before killing a PID recorded in a previous run, its OS start time must match the recorded one;
 *   a reused PID that now belongs to another program is never touched.
 * Commands are argument vectors; no shell strings are built (R8). On Windows the PowerShell script is a
 * constant and the PID travels through an environment variable.
 */
import { execFile } from 'node:child_process';
import type { Logger, SessionStatus } from '@jarvis/core';

export interface ProcessInspector {
  /** Epoch ms when the process started, or null if it does not exist. */
  startTime(pid: number): Promise<number | null>;
  killTree(pid: number): Promise<void>;
}

/** Tolerance between the time we recorded at spawn and the OS-reported start time. */
export const START_TIME_TOLERANCE_MS = 5_000;

const run = (cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10_000, windowsHide: true, env: env ?? process.env }, (err, stdout) =>
      err ? reject(err) : resolve(String(stdout)),
    );
  });

const PS_START_TIME =
  '$p = Get-Process -Id ([int]$env:JARVIS_INSPECT_PID) -ErrorAction SilentlyContinue; if ($p) { [DateTimeOffset]::new($p.StartTime).ToUnixTimeMilliseconds() }';

export class OsProcessInspector implements ProcessInspector {
  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  async startTime(pid: number): Promise<number | null> {
    if (!Number.isSafeInteger(pid) || pid <= 0) return null;
    try {
      if (this.platform === 'win32') {
        const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_START_TIME], {
          ...process.env,
          JARVIS_INSPECT_PID: String(pid),
        });
        const ms = Number(out.trim());
        return out.trim() && Number.isFinite(ms) ? ms : null;
      }
      const out = await run('ps', ['-o', 'lstart=', '-p', String(pid)], { ...process.env, LC_ALL: 'C' });
      const ms = Date.parse(out.trim());
      return Number.isFinite(ms) ? ms : null;
    } catch {
      return null;
    }
  }

  async killTree(pid: number): Promise<void> {
    if (!Number.isSafeInteger(pid) || pid <= 0) return;
    if (this.platform === 'win32') {
      await run('taskkill', ['/T', '/F', '/PID', String(pid)]).catch(() => undefined);
      return;
    }
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 3_000));
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

export interface ProcessRecord {
  id: string;
  pid: number;
  startTime: number;
  status: SessionStatus;
}

export interface ReapResult {
  killed: string[];
  skipped: string[];
  gone: string[];
}

/**
 * Reaps agent processes left over by a previous run. A PID is killed only when its current start time
 * matches the recorded one (within tolerance); otherwise it was reused and is left alone.
 */
export async function reapOrphans(
  records: ProcessRecord[],
  inspector: ProcessInspector,
  logger: Logger,
): Promise<ReapResult> {
  const res: ReapResult = { killed: [], skipped: [], gone: [] };
  for (const r of records) {
    const started = await inspector.startTime(r.pid);
    if (started === null) {
      res.gone.push(r.id);
      continue;
    }
    if (Math.abs(started - r.startTime) > START_TIME_TOLERANCE_MS) {
      logger.warn('orphan reaping skipped: PID reused by another process', { session: r.id, pid: r.pid });
      res.skipped.push(r.id);
      continue;
    }
    await inspector.killTree(r.pid);
    logger.info('reaped orphan agent process', { session: r.id, pid: r.pid });
    res.killed.push(r.id);
  }
  return res;
}

/** Tracks live agent processes of this run so they can be killed (and recorded for reaping). */
export interface ProcessTracker {
  register(sessionId: string, pid: number, startTime: number): void;
  unregister(sessionId: string): void;
}
