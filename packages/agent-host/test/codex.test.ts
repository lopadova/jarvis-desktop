import { describe, expect, it } from 'vitest';
import { CodexDriver, codexSandboxFor } from '../src/agents/codex.js';
import { MemoryLogger } from '../src/log/logger.js';
import { makeApp, tmp } from './helpers.js';

describe('Codex fail-safe sandbox mapping (R1)', () => {
  it('maps permission levels per OS', () => {
    expect(codexSandboxFor('safe', 'darwin')).toMatchObject({ sandboxMode: 'read-only', network: false });
    expect(codexSandboxFor('safe', 'win32').notice).toMatch(/Safe mode Codex can only read/);
    expect(codexSandboxFor('trusted', 'darwin')).toEqual({ sandboxMode: 'workspace-write', network: false });
    expect(codexSandboxFor('trusted', 'linux')).toEqual({ sandboxMode: 'workspace-write', network: false });
    expect(codexSandboxFor('trusted', 'win32')).toMatchObject({ sandboxMode: 'read-only', network: false });
    expect(codexSandboxFor('full-auto', 'win32')).toEqual({ sandboxMode: 'workspace-write', network: true });
  });

  it('the driver passes the mapped sandbox to the thread, never escalates, and strips OPENAI_API_KEY', async () => {
    const t = await makeApp();
    const seen: unknown[] = [];
    const envs: Record<string, string>[] = [];
    const fakeThread = { runStreamed: async () => ({ events: (async function* () {})() }) };
    process.env.OPENAI_API_KEY = 'sk-should-not-pass-1234567';
    const d = new CodexDriver({
      settings: () => t.app.settings(),
      logger: new MemoryLogger(),
      discover: () => '/usr/bin/codex',
      platform: 'linux',
      createCodex: (o) => {
        envs.push((o?.env ?? {}) as Record<string, string>);
        return {
          startThread: (opts: unknown) => {
            seen.push(opts);
            return fakeThread;
          },
          resumeThread: (_id: string, opts: unknown) => {
            seen.push(opts);
            return fakeThread;
          },
        } as never;
      },
    });
    const run = async (permission: 'safe' | 'trusted') => {
      const events = [];
      for await (const e of d.run({
        task: 'x',
        cwd: tmp(),
        guidance: '',
        permission,
        allowlist: [],
        signal: new AbortController().signal,
        requestApproval: async () => 'deny',
      })) {
        events.push(e);
      }
      return events;
    };
    const safeEvents = await run('safe');
    await run('trusted');
    delete process.env.OPENAI_API_KEY;
    expect(seen[0]).toMatchObject({ sandboxMode: 'read-only', approvalPolicy: 'never', networkAccessEnabled: false });
    expect(seen[1]).toMatchObject({
      sandboxMode: 'workspace-write',
      approvalPolicy: 'never',
      networkAccessEnabled: false,
    });
    expect(safeEvents[0]).toMatchObject({ type: 'activity', text: expect.stringMatching(/only read/) });
    expect(envs[0]?.OPENAI_API_KEY).toBeUndefined();
  });
});
