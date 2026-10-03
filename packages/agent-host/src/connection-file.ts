/**
 * `run/agent-host.json` lets local MCP bridges find the sidecar. It carries `mcpToken`, which only
 * authorises the `mcp` role (`mcp.call`). Owner-only (R6):
 *  - Unix: mode 0600.
 *  - Windows: POSIX modes are ignored, so right after writing, `icacls` removes the inherited ACL
 *    (which also lets SYSTEM and Administrators read it) and grants full control to the current user
 *    only, identified by SID (`whoami /user`). Argument vectors only, no shell (R8). If tightening fails
 *    the file still lives in the per-user app-data folder and a warning is logged.
 */
import { execFile } from 'node:child_process';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type ConnectionFile, DATA_FILES, type Logger } from '@jarvis/core';

export const connectionPath = (dataDir: string): string => join(dataDir, DATA_FILES.connection);

export type Exec = (cmd: string, args: string[]) => Promise<string>;

const execArgs: Exec = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10_000, windowsHide: true }, (err, stdout) =>
      err ? reject(err) : resolve(String(stdout)),
    );
  });

const SID_RE = /^S-1-\d+(-\d+)+$/;

/** Absolute System32 paths, so a `whoami`/`icacls` earlier on PATH (Git, MSYS) is never picked up. */
export const system32 = (env: NodeJS.ProcessEnv = process.env): string =>
  join(env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows', 'System32');

/** Parses the SID from `whoami /user /fo csv /nh` ("domain\user","S-1-5-21-…"). */
export function parseWhoamiSid(out: string): string | null {
  const m = /"([^"]*)","(S-1-[\d-]+)"/.exec(out.trim());
  return m?.[2] && SID_RE.test(m[2]) ? m[2] : null;
}

/** `icacls` arguments that leave exactly one ACE: full control for `sid`. */
export function ownerOnlyAclArgs(file: string, sid: string): string[] {
  if (!SID_RE.test(sid)) throw new Error('invalid SID');
  return [file, '/inheritance:r', '/grant:r', `*${sid}:F`];
}

/** Restricts `file` to the current Windows user. Returns false (and logs) when it could not. */
export async function restrictToCurrentUser(file: string, exec: Exec = execArgs, logger?: Logger): Promise<boolean> {
  try {
    const sys = system32();
    const sid = parseWhoamiSid(await exec(join(sys, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh']));
    if (!sid) throw new Error('could not read the current user SID');
    await exec(join(sys, 'icacls.exe'), ownerOnlyAclArgs(file, sid));
    return true;
  } catch (e) {
    logger?.warn('could not restrict the connection file ACL', { error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

export async function writeConnectionFile(
  dataDir: string,
  info: ConnectionFile,
  opts: { platform?: NodeJS.Platform; exec?: Exec; logger?: Logger } = {},
): Promise<string> {
  const file = connectionPath(dataDir);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const platform = opts.platform ?? process.platform;
  if (platform === 'win32') {
    // Write an empty file first and tighten its ACL, so the token is never readable by others.
    await writeFile(file, '', { mode: 0o600 });
    await restrictToCurrentUser(file, opts.exec, opts.logger);
    await writeFile(file, JSON.stringify(info));
  } else {
    await writeFile(file, JSON.stringify(info), { mode: 0o600 });
    await chmod(file, 0o600);
  }
  return file;
}

export async function removeConnectionFile(dataDir: string): Promise<void> {
  await rm(connectionPath(dataDir), { force: true });
}
