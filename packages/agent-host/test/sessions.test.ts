import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Project } from '@jarvis/core';
import { describe, expect, it, vi } from 'vitest';
import { PROGRESS_FIRST_MS } from '../src/sessions.js';
import { makeApp, tick, until } from './helpers.js';

describe('session concurrency (counts every live status)', () => {
  it('counts running, needs-input and approval sessions against the limit', async () => {
    const t = await makeApp({ settings: { maxConcurrentSessions: 2 } });
    t.drivers.claude.hold();
    const a = t.app.sessions.start({ agent: 'claude', project: null, task: 'one', coding: false });
    const b = t.app.sessions.start({ agent: 'claude', project: null, task: 'two', coding: false });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    t.app.sessions.setNeedsInput(a.session.id, true);
    expect(t.app.sessions.get(a.session.id)?.status).toBe('needs-input');
    const c = t.app.sessions.start({ agent: 'claude', project: null, task: 'three', coding: false });
    expect(c).toEqual({ ok: false, reason: 'limit' });
    t.app.sessions.stop(b.session.id);
    const d = t.app.sessions.start({ agent: 'claude', project: null, task: 'four', coding: false });
    expect(d.ok).toBe(true);
    t.drivers.claude.finish();
  });

  it('a session waiting for approval still counts', async () => {
    const t = await makeApp({ settings: { maxConcurrentSessions: 1 } });
    t.drivers.claude.beforeResult = async (opts) => {
      await opts.requestApproval({ kind: 'shell', risk: 'medium', title: 'run tests', detail: 'pnpm test' });
    };
    const a = t.app.sessions.start({ agent: 'claude', project: null, task: 'one', coding: false });
    if (!a.ok) throw new Error('start failed');
    await until(() => t.app.sessions.get(a.session.id)?.status === 'approval');
    expect(t.app.sessions.start({ agent: 'claude', project: null, task: 'two', coding: false })).toMatchObject({
      ok: false,
      reason: 'limit',
    });
    t.app.sessions.stop(a.session.id);
  });
});

describe('follow-ups (R8)', () => {
  it('queues follow-ups while running and delivers them by resuming', async () => {
    const t = await makeApp();
    t.drivers.claude.hold();
    const r = t.app.sessions.start({ agent: 'claude', project: null, task: 'build a page', coding: true });
    if (!r.ok) throw new Error('start failed');
    await until(() => t.app.sessions.get(r.session.id)?.agentSessionId === 'agent-1');
    expect(t.app.sessions.followup(r.session.id, 'also add a footer')).toBe('queued');
    expect(t.app.sessions.queuedFollowups(r.session.id)).toEqual(['also add a footer']);
    t.drivers.claude.finish();
    await until(() => t.drivers.claude.runs.length === 2);
    expect(t.drivers.claude.runs[1]?.resumeId).toBe('agent-1');
    expect(t.drivers.claude.runs[1]?.task).toBe('also add a footer');
  });

  it('clears queued follow-ups on cancel and on stop-all', async () => {
    const t = await makeApp();
    t.drivers.claude.hold();
    const r = t.app.sessions.start({ agent: 'claude', project: null, task: 'build', coding: true });
    if (!r.ok) throw new Error('start failed');
    await tick(10);
    t.app.sessions.followup(r.session.id, 'then deploy it');
    t.app.sessions.stop(r.session.id);
    expect(t.app.sessions.queuedFollowups(r.session.id)).toEqual([]);
    t.drivers.claude.finish();
    await tick(30);
    expect(t.drivers.claude.runs).toHaveLength(1);
    expect(t.app.sessions.get(r.session.id)?.status).toBe('cancelled');

    t.drivers.claude.hold();
    const r2 = t.app.sessions.start({ agent: 'claude', project: null, task: 'again', coding: true });
    if (!r2.ok) throw new Error('start failed');
    await tick(10);
    t.app.sessions.followup(r2.session.id, 'push it');
    expect(t.app.sessions.stopAll()).toBe(1);
    expect(t.app.sessions.queuedFollowups(r2.session.id)).toEqual([]);
    t.drivers.claude.finish();
    await tick(30);
    expect(t.drivers.claude.runs).toHaveLength(2);
  });

  it('resumes a finished session via the agent-side session id', async () => {
    const t = await makeApp();
    const r = t.app.sessions.start({ agent: 'claude', project: null, task: 'write a poem', coding: false });
    if (!r.ok) throw new Error('start failed');
    await until(() => t.app.sessions.get(r.session.id)?.status === 'done');
    expect(t.app.sessions.followup(r.session.id, 'make it shorter')).toBe('resumed');
    await until(() => t.drivers.claude.runs.length === 2);
    expect(t.drivers.claude.runs[1]?.resumeId).toBe('agent-1');
  });
});

describe('completion', () => {
  it('opens a localhost result, summarises through the brain and writes an NDJSON log', async () => {
    const t = await makeApp();
    t.drivers.claude.result = {
      type: 'result',
      text: 'Server running at http://localhost:5173/ — done.',
      isError: false,
    };
    t.brain.push({ text: '{"speak":"[happy] Your site is live."}', json: { speak: '[happy] Your site is live.' } });
    const r = t.app.sessions.start({ agent: 'claude', project: null, task: 'start the dev server', coding: true });
    if (!r.ok) throw new Error('start failed');
    await until(() => t.host.spoken().includes('Your site is live.'));
    expect(t.host.of('host.open')).toEqual([{ target: 'http://localhost:5173/', kind: 'url' }]);
    expect(t.brain.requests[0]?.messages[1]?.content).toMatch(/<untrusted_data/);
    const log = readFileSync(t.app.sessions.logPath(r.session.id), 'utf8').trim().split('\n');
    expect(JSON.parse(log[0] as string)).toMatchObject({ type: 'start' });
    expect(log.some((l) => JSON.parse(l).type === 'result')).toBe(true);
  });

  it('never auto-opens a non-local URL or a file outside the session folder', async () => {
    const t = await makeApp();
    t.drivers.claude.result = {
      type: 'result',
      text: 'See https://evil.example/phish for details.',
      isError: false,
      url: 'C:\\Windows\\System32\\calc.exe',
    };
    const r = t.app.sessions.start({ agent: 'claude', project: null, task: 'do it', coding: true });
    if (!r.ok) throw new Error('start failed');
    await until(() => t.app.sessions.get(r.session.id)?.status === 'done');
    await tick(20);
    expect(t.app.sessions.get(r.session.id)?.resultUrl).toBeUndefined();
    expect(t.host.of('host.open')).toEqual([]);
  });

  it('falls back to a phrase when the summary brain fails', async () => {
    const t = await makeApp();
    t.brain.push(new Error('boom'));
    const r = t.app.sessions.start({ agent: 'claude', project: null, task: 'x', coding: false });
    if (!r.ok) throw new Error('start failed');
    await until(() => t.host.spoken().includes('General is done.'));
  });
});

describe('progress narration', () => {
  it('speaks after 20 s and not again within 45 s', async () => {
    const t = await makeApp();
    t.drivers.claude.hold();
    t.drivers.claude.events = [
      { type: 'session-id', id: 'a1' },
      { type: 'narration', text: 'Editing the hero section.' },
    ];
    const r = t.app.sessions.start({ agent: 'claude', project: null, task: 'x', coding: false });
    if (!r.ok) throw new Error('start failed');
    await tick(10);
    const s = t.app.sessions.get(r.session.id);
    if (!s) throw new Error('no session');
    s.startedAt = Date.now() - PROGRESS_FIRST_MS - 1000;
    expect(await t.app.sessions.tickProgress()).toBe(true);
    expect(t.host.spoken().at(-1)).toMatch(/^21 seconds in, editing the hero section/);
    expect(await t.app.sessions.tickProgress()).toBe(false); // too soon
    t.drivers.claude.finish();
  });
});

describe('projects', () => {
  it('runs in the project folder with its permission level', async () => {
    const t = await makeApp();
    const path = join(t.dataDir, 'proj');
    mkdirSync(path);
    const project: Project = {
      id: 'p1',
      name: 'Proj',
      path,
      aliases: [],
      defaultAgent: 'claude',
      permission: 'trusted',
      allowlist: ['pnpm test'],
    };
    const r = t.app.sessions.start({ agent: 'claude', project, task: 'x', coding: false });
    if (!r.ok) throw new Error('start failed');
    await until(() => t.drivers.claude.runs.length === 1);
    expect(t.drivers.claude.runs[0]).toMatchObject({ cwd: path, permission: 'trusted', allowlist: ['pnpm test'] });
    const capped = t.app.sessions.start({ agent: 'claude', project, task: 'y', coding: false, permissionCap: 'safe' });
    if (!capped.ok) throw new Error('start failed');
    await until(() => t.drivers.claude.runs.length === 2);
    expect(t.drivers.claude.runs[1]?.permission).toBe('safe');
  });
});

describe('jarvis_ask_user → needs-input', () => {
  it('marks the calling session needs-input while waiting, back to running after the answer, counted as live', async () => {
    const t = await makeApp({ settings: { maxConcurrentSessions: 1 } });
    t.drivers.claude.hold();
    const a = t.app.sessions.start({ agent: 'claude', project: null, task: 'one', coding: false });
    if (!a.ok) throw new Error('start failed');
    const id = a.session.id;
    const pending = t.app.mcp.call({
      tool: 'jarvis_ask_user',
      args: { question: 'Which port?', options: ['3000', '8080'], timeoutSeconds: 30 },
      origin: 'stdio',
      callerSessionId: id,
    });
    await until(() => t.app.sessions.get(id)?.status === 'needs-input');
    const view = t.ui
      .of<{ sessions: { id: string; status: string }[] }>('ui.sessions')
      .at(-1)
      ?.sessions.find((s) => s.id === id);
    expect(view?.status).toBe('needs-input');
    expect(t.app.sessions.liveCount()).toBe(1);
    expect(t.app.sessions.start({ agent: 'claude', project: null, task: 'two', coding: false })).toMatchObject({
      ok: false,
      reason: 'limit',
    });
    await t.app.orchestrator.submit('8080', 'text');
    const res = await pending;
    expect(res.content[0]?.text).toBe('8080');
    expect(t.app.sessions.get(id)?.status).toBe('running');
    t.drivers.claude.finish();
  });

  it('goes back to running after a timeout; a stop wins; unverified callers mark nothing', async () => {
    const t = await makeApp();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const settle = () => vi.advanceTimersByTimeAsync(0);
    t.drivers.claude.hold();
    const a = t.app.sessions.start({ agent: 'claude', project: null, task: 'one', coding: false });
    if (!a.ok) throw new Error('start failed');
    const id = a.session.id;
    const pending = t.app.mcp.call({
      tool: 'jarvis_ask_user',
      args: { question: 'Continue?', timeoutSeconds: 10 },
      origin: 'stdio',
      callerSessionId: id,
    });
    await settle();
    expect(t.app.sessions.get(id)?.status).toBe('needs-input');
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await pending).content[0]?.text).toBeTruthy();
    expect(t.app.sessions.get(id)?.status).toBe('running');
    const again = t.app.mcp.call({
      tool: 'jarvis_ask_user',
      args: { question: 'Still there?', timeoutSeconds: 10 },
      origin: 'stdio',
      callerSessionId: id,
    });
    await settle();
    expect(t.app.sessions.get(id)?.status).toBe('needs-input');
    t.app.sessions.stop(id);
    await vi.advanceTimersByTimeAsync(10_000);
    await again;
    expect(t.app.sessions.get(id)?.status).toBe('cancelled');
    const b = t.app.sessions.start({ agent: 'claude', project: null, task: 'two', coding: false });
    if (!b.ok) throw new Error('start failed');
    const ext = t.app.mcp.call({
      tool: 'jarvis_ask_user',
      args: { question: 'Hi?', timeoutSeconds: 10 },
      origin: 'relay',
    });
    await settle();
    expect(t.app.sessions.get(b.session.id)?.status).toBe('running');
    await vi.advanceTimersByTimeAsync(10_000);
    await ext;
    vi.useRealTimers();
    t.drivers.claude.finish();
  });
});
