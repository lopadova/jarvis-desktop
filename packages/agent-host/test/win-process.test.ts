import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  connectionPath,
  ownerOnlyAclArgs,
  parseWhoamiSid,
  restrictToCurrentUser,
  writeConnectionFile,
} from '../src/connection-file.js';
import { MemoryLogger } from '../src/log/logger.js';
import { OsProcessInspector } from '../src/process/proc.js';
import { createJobApi, type FfiLike, type JobApi, loadWindowsJobApi } from '../src/process/win-job.js';
import { tmp } from './helpers.js';

const SID = 'S-1-5-21-1111111111-2222222222-3333333333-1001';
const info = { port: 1, mcpToken: 'mcp-token-secret', pid: 2, version: '0', startedAt: 3 };

describe('connection file ACL on Windows (R6)', () => {
  it('parses the SID from whoami and builds icacls arguments as a vector', () => {
    expect(parseWhoamiSid(`"laptop\\lorenzo","${SID}"\r\n`)).toBe(SID);
    expect(parseWhoamiSid('garbage')).toBeNull();
    const file = 'C:\\Users\\A B\\AppData\\Roaming\\Jarvis\\run\\agent-host.json & calc.exe';
    expect(ownerOnlyAclArgs(file, SID)).toEqual([file, '/inheritance:r', '/grant:r', `*${SID}:F`]);
    expect(() => ownerOnlyAclArgs(file, 'Everyone')).toThrow(/invalid SID/);
    expect(() => ownerOnlyAclArgs(file, `${SID} /grant Everyone:F`)).toThrow(/invalid SID/);
  });

  it('tightens the ACL before the token is written, using System32 binaries', async () => {
    const dir = tmp();
    const calls: { cmd: string; args: string[]; content: string }[] = [];
    const exec = async (cmd: string, args: string[]) => {
      calls.push({ cmd, args, content: readFileSync(connectionPath(dir), 'utf8') });
      return cmd.endsWith('whoami.exe') ? `"pc\\me","${SID}"` : 'processed 1 files';
    };
    await writeConnectionFile(dir, info, { platform: 'win32', exec });
    expect(calls.map((c) => c.cmd.replace(/\\/g, '/').split('/').slice(-2).join('/'))).toEqual([
      'System32/whoami.exe',
      'System32/icacls.exe',
    ]);
    expect(calls[1]?.args).toEqual([connectionPath(dir), '/inheritance:r', '/grant:r', `*${SID}:F`]);
    expect(calls.every((c) => c.content === '')).toBe(true);
    expect(JSON.parse(readFileSync(connectionPath(dir), 'utf8'))).toEqual(info);
  });

  it('logs and continues when the ACL cannot be set', async () => {
    const logger = new MemoryLogger();
    const file = join(tmp(), 'x.json');
    writeFileSync(file, '');
    const ok = await restrictToCurrentUser(
      file,
      async () => {
        throw new Error('icacls missing');
      },
      logger,
    );
    expect(ok).toBe(false);
    expect(logger.lines.join(' ')).toContain('could not restrict');
  });

  it.runIf(process.platform === 'win32')('really leaves only the current user on the file (Windows)', async () => {
    const dir = tmp();
    const file = await writeConnectionFile(dir, info);
    const acl = execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'icacls.exe'), [file], {
      encoding: 'utf8',
    });
    const user = (process.env.USERNAME ?? '').toLowerCase();
    const aces = acl
      .split(/\r?\n/)
      .map((l) => l.replace(file, '').trim())
      .filter((l) => l.includes(':('));
    expect(aces).toHaveLength(1);
    expect(aces[0]?.toLowerCase()).toContain(user);
    expect(aces[0]).toContain('(F)');
  });
});

describe('Windows Job Objects (R7)', () => {
  function fakeFfi(opts: { openFails?: boolean; assignFails?: boolean } = {}) {
    const calls: [string, unknown[]][] = [];
    let next = 100;
    const fn =
      (name: string, ret: (args: unknown[]) => unknown) =>
      (...args: unknown[]) => {
        calls.push([name, args]);
        return ret(args);
      };
    const ffi: FfiLike = {
      FFIType: { ptr: 'ptr', i32: 'i32', u32: 'u32' },
      dlopen: (lib, symbols) => {
        calls.push(['dlopen', [lib, Object.keys(symbols)]]);
        return {
          close: () => undefined,
          symbols: {
            CreateJobObjectW: fn('CreateJobObjectW', () => next++),
            OpenProcess: fn('OpenProcess', () => (opts.openFails ? null : next++)),
            AssignProcessToJobObject: fn('AssignProcessToJobObject', () => (opts.assignFails ? 0 : 1)),
            TerminateJobObject: fn('TerminateJobObject', () => 1),
            CloseHandle: fn('CloseHandle', () => 1),
          },
        };
      },
    };
    return { ffi, calls };
  }

  it('creates a job, assigns the process with only quota+terminate rights, terminates and closes it', () => {
    const { ffi, calls } = fakeFfi();
    const api = createJobApi(ffi);
    const job = api.attach(4242);
    expect(job).not.toBeNull();
    expect(calls.find((c) => c[0] === 'OpenProcess')?.[1]).toEqual([0x0101, 0, 4242]);
    expect(calls.find((c) => c[0] === 'AssignProcessToJobObject')?.[1]).toEqual([100, 101]);
    // The process handle is closed right away; the job handle stays open.
    expect(calls.filter((c) => c[0] === 'CloseHandle').map((c) => c[1][0])).toEqual([101]);
    expect(job?.terminate()).toBe(true);
    job?.close();
    job?.close();
    expect(calls.filter((c) => c[0] === 'CloseHandle').map((c) => c[1][0])).toEqual([101, 100]);
    expect(job?.terminate()).toBe(false);
    expect(api.attach(-1)).toBeNull();
  });

  it('cleans up and returns null when the process cannot be opened or assigned', () => {
    const a = fakeFfi({ openFails: true });
    expect(createJobApi(a.ffi).attach(1)).toBeNull();
    expect(a.calls.filter((c) => c[0] === 'CloseHandle').map((c) => c[1][0])).toEqual([100]);
    const b = fakeFfi({ assignFails: true });
    expect(createJobApi(b.ffi).attach(1)).toBeNull();
    expect(b.calls.filter((c) => c[0] === 'CloseHandle')).toHaveLength(2);
  });

  it('is unavailable under Node and on other platforms (taskkill /T stays the fallback)', async () => {
    expect(await loadWindowsJobApi('linux')).toBeNull();
    if (!process.versions.bun) expect(await loadWindowsJobApi('win32')).toBeNull();
  });

  it('the inspector terminates the job on kill and only releases it after a normal end', async () => {
    const events: string[] = [];
    const api: JobApi = {
      attach: (pid) => ({
        terminate: () => {
          events.push(`terminate ${pid}`);
          return true;
        },
        close: () => {
          events.push(`close ${pid}`);
        },
      }),
    };
    const inspector = new OsProcessInspector('win32', api);
    await Promise.resolve();
    expect(inspector.usesJobObjects).toBe(true);
    inspector.adopt(999_991);
    inspector.adopt(999_992);
    inspector.release(999_992);
    await inspector.killTree(999_991);
    expect(events).toEqual(['close 999992', 'terminate 999991', 'close 999991']);
    const unix = new OsProcessInspector('linux', api);
    await Promise.resolve();
    unix.adopt(1);
    expect(events).toHaveLength(3);
  });
});
