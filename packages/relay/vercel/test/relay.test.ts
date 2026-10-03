import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRelay } from '../src/app.js';
import { OFFLINE_TEXT } from '../src/shared/mcp.js';
import { base32, pairingCodeFromHash, sha256Hex } from '../src/shared/pairing.js';
import { memoryStore } from '../src/store.js';

const BASE = 'https://relay.example';
const REDIRECT_URI = 'https://chatgpt.example/connector/oauth/callback';

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

function setup(overrides: Partial<Parameters<typeof createRelay>[0]> = {}) {
  const relay = createRelay({
    store: memoryStore(),
    longPollMs: 300,
    pollIntervalMs: 10,
    callTimeoutMs: 400,
    callsPerMinute: 5,
    ...overrides,
  });
  const call = (path: string, init?: RequestInit) => relay(new Request(`${BASE}${path}`, init));
  return { relay, call };
}

async function newPair() {
  const pairId = base32(crypto.getRandomValues(new Uint8Array(16))).toLowerCase();
  const secret = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const secretHash = await sha256Hex(secret);
  return { pairId, secret, secretHash, code: pairingCodeFromHash(secretHash) };
}
type Pair = Awaited<ReturnType<typeof newPair>>;
type Call = ReturnType<typeof setup>['call'];

const register = (call: Call, pair: Pair) =>
  call('/pair/register', {
    method: 'POST',
    body: JSON.stringify({ pairId: pair.pairId, secretHash: pair.secretHash, label: 'Laptop' }),
  });

const desktop = (call: Call, pair: Pair, path: string, init: RequestInit = {}) =>
  call(`${path}?pairId=${pair.pairId}`, {
    ...init,
    headers: { Authorization: `Bearer ${pair.secret}`, ...(init.headers ?? {}) },
  });

async function authorizeStart(call: Call) {
  const reg = await call('/oauth/register', {
    method: 'POST',
    body: JSON.stringify({ client_name: 'ChatGPT', redirect_uris: [REDIRECT_URI] }),
  });
  const { client_id: clientId } = (await reg.json()) as { client_id: string };
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    state: 's1',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: `${BASE}/mcp`,
  });
  return { clientId, verifier, params };
}

async function accessToken(call: Call, pair: Pair): Promise<string> {
  const { clientId, verifier, params } = await authorizeStart(call);
  const form = new URLSearchParams(params);
  form.set('code', pair.code);
  form.set('decision', 'approve');
  const res = await call('/authorize', { method: 'POST', body: form });
  expect(res.status).toBe(302);
  const code = new URL(res.headers.get('Location') ?? '').searchParams.get('code') ?? '';
  const tok = await call('/oauth/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
    }),
  });
  expect(tok.status).toBe(200);
  return ((await tok.json()) as { access_token: string }).access_token;
}

const mcp = async (call: Call, token: string, method: string, params?: unknown) => {
  const res = await call('/mcp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'openai-mcp' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return {
    status: res.status,
    body: res.status === 200 ? ((await res.json()) as { result?: any; error?: any }) : null,
  };
};

describe('shared protocol code', () => {
  it('vercel/src/shared is an exact copy of src/shared (run `pnpm --filter @jarvis/relay sync:vercel`)', () => {
    const root = join(import.meta.dirname, '..', '..');
    for (const file of readdirSync(join(root, 'src', 'shared'))) {
      expect(readFileSync(join(root, 'vercel', 'src', 'shared', file), 'utf8'), file).toBe(
        readFileSync(join(root, 'src', 'shared', file), 'utf8'),
      );
    }
  });
});

describe('Vercel relay (long-poll)', () => {
  it('registers pairs and rejects duplicates', async () => {
    const { call } = setup();
    const pair = await newPair();
    expect((await register(call, pair)).status).toBe(201);
    expect((await register(call, pair)).status).toBe(409);
  });

  it('rejects a wrong desktop secret', async () => {
    const { call } = setup();
    const pair = await newPair();
    await register(call, pair);
    const res = await call(`/desktop/poll?pairId=${pair.pairId}`, { headers: { Authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
  });

  it('rejects a wrong pairing code on the authorize page', async () => {
    const { call } = setup();
    const pair = await newPair();
    await register(call, pair);
    const { params } = await authorizeStart(call);
    const page = await call(`/authorize?${params}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Pairing code');
    const form = new URLSearchParams(params);
    form.set('code', pair.code === 'AAAAAAAA' ? 'BBBBBBBB' : 'AAAAAAAA');
    form.set('decision', 'approve');
    const res = await call('/authorize', { method: 'POST', body: form });
    expect(res.status).toBe(400);
  });

  it('round-trips a tool call through poll + result', async () => {
    const { call } = setup();
    const pair = await newPair();
    await register(call, pair);
    const hello = await desktop(call, pair, '/desktop/result', {
      method: 'POST',
      body: JSON.stringify({ type: 'hello', version: '0.1.0', tools: [{ name: 'jarvis_recall', readOnly: true }] }),
    });
    expect(hello.status).toBe(204);
    const token = await accessToken(call, pair);
    expect((await mcp(call, token, 'tools/list')).body?.result.tools.map((t: { name: string }) => t.name)).toEqual([
      'jarvis_recall',
    ]);

    const pending = mcp(call, token, 'tools/call', { name: 'jarvis_recall', arguments: {} });
    const polled = await desktop(call, pair, '/desktop/poll');
    expect(polled.status).toBe(200);
    const frame = (await polled.json()) as { id: string; tool: string; client: string };
    expect(frame).toMatchObject({ type: 'call', tool: 'jarvis_recall', client: 'chatgpt' });
    await desktop(call, pair, '/desktop/result', {
      method: 'POST',
      body: JSON.stringify({ type: 'result', id: frame.id, ok: true, content: [{ type: 'text', text: 'Likes tea' }] }),
    });
    expect((await pending).body?.result).toEqual({ content: [{ type: 'text', text: 'Likes tea' }] });
  });

  it('returns 204 when nothing arrives within the long-poll window', async () => {
    const { call } = setup();
    const pair = await newPair();
    await register(call, pair);
    expect((await desktop(call, pair, '/desktop/poll')).status).toBe(204);
  });

  it('times out when the desktop never answers, then rate limits', async () => {
    const { call } = setup();
    const pair = await newPair();
    await register(call, pair);
    const token = await accessToken(call, pair);
    // `hello` marks the desktop online, but nobody polls: the call times out.
    await desktop(call, pair, '/desktop/result', {
      method: 'POST',
      body: JSON.stringify({ type: 'hello', version: '0.1.0', tools: [{ name: 'jarvis_recall', readOnly: true }] }),
    });
    const timedOut = await mcp(call, token, 'tools/call', { name: 'jarvis_recall', arguments: {} });
    expect(timedOut.body?.result.content[0].text).toMatch(/did not answer/);
    for (let i = 0; i < 4; i++) await mcp(call, token, 'tools/call', { name: 'jarvis_recall', arguments: {} });
    const limited = await mcp(call, token, 'tools/call', { name: 'jarvis_recall', arguments: {} });
    expect(limited.body?.result.content[0].text).toMatch(/Too many calls/);
  });

  it('says offline when the desktop has not polled recently', async () => {
    const store = memoryStore();
    const { call } = setup({ store });
    const pair = await newPair();
    await register(call, pair);
    await desktop(call, pair, '/desktop/result', {
      method: 'POST',
      body: JSON.stringify({ type: 'hello', version: '0.1.0', tools: [{ name: 'jarvis_recall', readOnly: true }] }),
    });
    await store.del(`seen:${pair.pairId}`);
    const token = await accessToken(call, pair);
    const res = await mcp(call, token, 'tools/call', { name: 'jarvis_recall', arguments: {} });
    expect(res.body?.result).toEqual({ content: [{ type: 'text', text: OFFLINE_TEXT }], isError: true });
  });

  it('unpairing invalidates tokens and tombstones the pairId', async () => {
    const { call } = setup();
    const pair = await newPair();
    await register(call, pair);
    const token = await accessToken(call, pair);
    expect((await mcp(call, token, 'ping')).status).toBe(200);
    expect((await desktop(call, pair, '/pair/register', { method: 'DELETE' })).status).toBe(204);
    expect((await mcp(call, token, 'ping')).status).toBe(401);
    expect((await register(call, pair)).status).toBe(409);
  });

  it('only the owning desktop can post a result', async () => {
    const { call } = setup();
    const a = await newPair();
    const b = await newPair();
    await register(call, a);
    await register(call, b);
    const res = await desktop(call, b, '/desktop/result', {
      method: 'POST',
      body: JSON.stringify({ type: 'result', id: 'someone-elses-call', ok: true, content: [] }),
    });
    expect(res.status).toBe(404);
  });
});
