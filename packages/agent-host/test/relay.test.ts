import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SECRET_KEYS } from '@jarvis/core';
import { afterEach, describe, expect, it } from 'vitest';
import { type WebSocket, WebSocketServer } from 'ws';
import { base32, MAX_FRAME, pairingCode, resultFrame, sha256Hex, truncateUtf8 } from '../src/relay.js';
import { makeApp, tick, until } from './helpers.js';

interface FakeRelay {
  url: string;
  wss: WebSocketServer;
  registered: { pairId: string; secretHash: string; label: string }[];
  sockets: WebSocket[];
  received: Record<string, unknown>[];
  auth: string[];
  deleted: { url: string; auth: string }[];
  attempts: number;
}

let relays: FakeRelay[] = [];
afterEach(async () => {
  for (const r of relays) await new Promise((res) => r.wss.close(res));
  relays = [];
});

async function fakeRelay(opts: { rejectStatus?: number; autoPong?: boolean } = {}): Promise<FakeRelay> {
  const wss = new WebSocketServer({
    host: '127.0.0.1',
    port: 0,
    verifyClient: (_info: unknown, cb: (ok: boolean, code?: number) => void) => {
      relay.attempts++;
      if (opts.rejectStatus) cb(false, opts.rejectStatus);
      else cb(true);
    },
  });
  await new Promise((r) => wss.once('listening', r));
  const port = (wss.address() as AddressInfo).port;
  const relay: FakeRelay = {
    url: `http://127.0.0.1:${port}`,
    wss,
    registered: [],
    sockets: [],
    received: [],
    auth: [],
    deleted: [],
    attempts: 0,
  };
  wss.on('connection', (ws, req: IncomingMessage) => {
    relay.auth.push(String(req.headers.authorization));
    relay.sockets.push(ws);
    ws.on('message', (d) => {
      const msg = JSON.parse(d.toString()) as Record<string, unknown>;
      relay.received.push(msg);
      if (opts.autoPong !== false && msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
    });
  });
  relays.push(relay);
  return relay;
}

const fakeFetch =
  (relay: FakeRelay, statuses: number[] = [201], deleteStatus = 204) =>
  async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'DELETE') {
      relay.deleted.push({ url: String(url), auth: String((init.headers as Record<string, string>).Authorization) });
      return new Response(null, { status: deleteStatus });
    }
    const body = JSON.parse(String(init?.body));
    const status = statuses.shift() ?? 201;
    if (status === 201) relay.registered.push(body);
    return new Response(null, { status });
  };

describe('relay link client', () => {
  it('pairs: registers only the secret hash, stores the secret in the keyring, returns code + QR', async () => {
    const relay = await fakeRelay();
    const t = await makeApp({ relay: { fetch: fakeFetch(relay, [409, 201]) as typeof fetch } });
    const res = await t.app.relay.pair(relay.url);
    expect(relay.registered).toHaveLength(1);
    const reg = relay.registered[0];
    expect(reg?.pairId).toMatch(/^[a-z2-7]{26}$/);
    expect(res.pairId).toBe(reg?.pairId);
    const stored = JSON.parse((await t.secrets.get(SECRET_KEYS.relaySecret)) as string) as { secret: string };
    expect(reg?.secretHash).toBe(sha256Hex(stored.secret));
    expect(JSON.stringify(reg)).not.toContain(stored.secret);
    expect(res.code).toBe(pairingCode(stored.secret));
    expect(res.code).toMatch(/^[A-Z2-7]{8}$/);
    expect(res.qr).toBe(`${relay.url}/connect?pair=${res.pairId}`);
    expect(t.app.settings().relayUrl).toBe(relay.url);
    // Connects with the bearer secret and says hello with read-only tools only.
    await until(() => relay.received.some((m) => m.type === 'hello'));
    expect(relay.auth[0]).toBe(`Bearer ${stored.secret}`);
    const hello = relay.received.find((m) => m.type === 'hello') as { tools: { name: string; readOnly: boolean }[] };
    expect(hello.tools.length).toBeGreaterThan(0);
    expect(hello.tools.every((x) => x.readOnly)).toBe(true);
    expect(t.app.relay.status().status).toBe('connected');
    t.app.relay.stop();
  });

  it('dispatches calls to the MCP handler, refuses write tools, answers pings', async () => {
    const relay = await fakeRelay();
    const t = await makeApp({ relay: { fetch: fakeFetch(relay) as typeof fetch } });
    t.app.memory.add('likes espresso');
    await t.app.relay.pair(relay.url);
    await until(() => relay.sockets.length === 1);
    const ws = relay.sockets[0] as WebSocket;
    ws.send(JSON.stringify({ type: 'call', id: 'c1', tool: 'jarvis_recall', args: {}, client: 'chatgpt' }));
    ws.send(JSON.stringify({ type: 'call', id: 'c2', tool: 'jarvis_start_task', args: { task: 'rm -rf ~' } }));
    ws.send(JSON.stringify({ type: 'call', id: 'c3', tool: 'nope', args: {} }));
    ws.send(JSON.stringify({ type: 'ping', t: 42 }));
    await until(() => relay.received.filter((m) => m.type === 'result').length === 3);
    const byId = (id: string) => relay.received.find((m) => m.id === id) as Record<string, unknown>;
    expect(byId('c1')).toMatchObject({ ok: true });
    expect(JSON.stringify(byId('c1').content)).toContain('likes espresso');
    expect(byId('c2')).toMatchObject({ ok: false, error: 'tool not exposed on the relay' });
    expect(byId('c3')).toMatchObject({ ok: false });
    expect(relay.received).toContainEqual({ type: 'pong', t: 42 });
    expect(t.app.sessions.list()).toHaveLength(0);
    // Every relayed call is visible in the UI.
    expect(t.ui.of('ui.toast').length).toBeGreaterThan(0);
    t.app.relay.stop();
  });

  it('reconnects with backoff after the relay drops the socket', async () => {
    const relay = await fakeRelay();
    const t = await makeApp({
      relay: { fetch: fakeFetch(relay) as typeof fetch, backoff: { minMs: 20, maxMs: 50 } },
    });
    await t.app.relay.pair(relay.url);
    await until(() => relay.sockets.length === 1);
    relay.sockets[0]?.terminate();
    await until(() => relay.sockets.length === 2);
    await until(() => t.app.relay.status().status === 'connected');
    expect(t.ui.of<{ status: string }>('ui.relay').some((s) => s.status === 'offline')).toBe(true);
    await t.app.relay.unpair();
    expect(await t.secrets.get(SECRET_KEYS.relaySecret)).toBeNull();
    expect(t.app.relay.status().status).toBe('unpaired');
  });

  it('unpair revokes the pairing on the relay with the bearer secret, then forgets it', async () => {
    const relay = await fakeRelay();
    const t = await makeApp({ relay: { fetch: fakeFetch(relay) as typeof fetch } });
    const res = await t.app.relay.pair(relay.url);
    const stored = JSON.parse((await t.secrets.get(SECRET_KEYS.relaySecret)) as string) as { secret: string };
    expect(await t.app.relay.unpair()).toEqual({ remote: 'revoked' });
    expect(relay.deleted).toEqual([
      { url: `${relay.url}/pair/register?pairId=${res.pairId}`, auth: `Bearer ${stored.secret}` },
    ]);
    expect(await t.secrets.get(SECRET_KEYS.relaySecret)).toBeNull();
    expect(t.app.settings().relayUrl).toBe('');
  });

  it('unpair still forgets the pairing locally when the relay is unreachable or already forgot it', async () => {
    const relay = await fakeRelay();
    const t = await makeApp({ relay: { fetch: fakeFetch(relay, [201, 201], 401) as typeof fetch } });
    await t.app.relay.pair(relay.url);
    expect(await t.app.relay.unpair()).toEqual({ remote: 'already-gone' });
    const down = await makeApp({
      relay: {
        fetch: (async (_u: unknown, init?: RequestInit) => {
          if (init?.method === 'DELETE') throw new Error('ECONNREFUSED');
          return new Response(null, { status: 201 });
        }) as typeof fetch,
      },
    });
    await down.app.relay.pair(relay.url);
    expect(await down.app.relay.unpair()).toEqual({ remote: 'unreachable' });
    expect(await down.secrets.get(SECRET_KEYS.relaySecret)).toBeNull();
  });

  it('re-pairing revokes the previous pairing first and uses a new pairId', async () => {
    const relay = await fakeRelay();
    const t = await makeApp({ relay: { fetch: fakeFetch(relay) as typeof fetch } });
    const first = await t.app.relay.pair(relay.url);
    const second = await t.app.relay.pair(relay.url);
    expect(second.pairId).not.toBe(first.pairId);
    expect(relay.deleted.map((d) => d.url)).toEqual([`${relay.url}/pair/register?pairId=${first.pairId}`]);
    t.app.relay.stop();
  });

  it('4000 (replaced by a newer connection): goes offline with reason "replaced" and does not reconnect', async () => {
    const relay = await fakeRelay();
    const t = await makeApp({ relay: { fetch: fakeFetch(relay) as typeof fetch, backoff: { minMs: 10, maxMs: 20 } } });
    await t.app.relay.pair(relay.url);
    await until(() => t.app.relay.status().status === 'connected');
    relay.sockets[0]?.close(4000, 'Replaced by a newer connection');
    await until(() => t.app.relay.status().status === 'offline');
    expect(t.app.relay.status().reason).toBe('replaced');
    await tick(100);
    expect(relay.attempts).toBe(1);
    expect(await t.secrets.get(SECRET_KEYS.relaySecret)).not.toBeNull();
  });

  it('4001 (unpaired on the relay): forgets the pairing and reports "revoked"', async () => {
    const relay = await fakeRelay();
    const t = await makeApp({ relay: { fetch: fakeFetch(relay) as typeof fetch, backoff: { minMs: 10, maxMs: 20 } } });
    await t.app.relay.pair(relay.url);
    await until(() => t.app.relay.status().status === 'connected');
    relay.sockets[0]?.close(4001, 'Unpaired');
    await until(() => t.app.relay.status().status === 'unpaired');
    expect(t.app.relay.status().reason).toBe('revoked');
    await tick(100);
    expect(await t.secrets.get(SECRET_KEYS.relaySecret)).toBeNull();
    expect(relay.attempts).toBe(1);
  });

  it('1009 (frame too large): reconnects with backoff and flags a protocol error', async () => {
    const relay = await fakeRelay();
    const t = await makeApp({ relay: { fetch: fakeFetch(relay) as typeof fetch, backoff: { minMs: 10, maxMs: 20 } } });
    await t.app.relay.pair(relay.url);
    await until(() => relay.sockets.length === 1);
    relay.sockets[0]?.close(1009, 'Frame larger than 64 KB');
    await until(() => t.ui.of<{ reason?: string }>('ui.relay').some((s) => s.reason === 'protocol-error'));
    await until(() => relay.sockets.length === 2 && t.app.relay.status().status === 'connected');
    t.app.relay.stop();
  });

  it('HTTP 401 on the upgrade: offline with reason "auth-failed", retried only at the slowest backoff', async () => {
    const relay = await fakeRelay({ rejectStatus: 401 });
    const t = await makeApp({ relay: { fetch: fakeFetch(relay) as typeof fetch, backoff: { minMs: 10, maxMs: 400 } } });
    await t.app.relay.pair(relay.url);
    await until(() => t.app.relay.status().reason === 'auth-failed');
    await tick(150);
    expect(relay.attempts).toBe(1);
    await until(() => relay.attempts >= 2, 2000);
    t.app.relay.stop();
  });

  it('reconnects when the relay stops answering pings', async () => {
    const relay = await fakeRelay({ autoPong: false });
    const t = await makeApp({
      relay: { fetch: fakeFetch(relay) as typeof fetch, pingMs: 30, backoff: { minMs: 10, maxMs: 20 } },
    });
    await t.app.relay.pair(relay.url);
    await until(() => relay.sockets.length >= 2, 3000);
    t.app.relay.stop();
  });

  it('ignores binary frames and never sends a result frame larger than 64 KB', async () => {
    const relay = await fakeRelay();
    const t = await makeApp({ relay: { fetch: fakeFetch(relay) as typeof fetch } });
    // 3-byte characters: 30 000 of them are ~90 KB of UTF-8 although the string length is below 64 K.
    for (let i = 0; i < 3; i++) t.app.memory.add(`note ${i} ${'€'.repeat(10_000)}`);
    await t.app.relay.pair(relay.url);
    await until(() => relay.sockets.length === 1);
    const ws = relay.sockets[0] as WebSocket;
    const sizes: number[] = [];
    ws.on('message', (d) => sizes.push((d as Buffer).byteLength));
    ws.send(Buffer.from(JSON.stringify({ type: 'call', id: 'bin', tool: 'jarvis_recall', args: {} })));
    ws.send(JSON.stringify({ type: 'call', id: 'big', tool: 'jarvis_recall', args: {} }));
    await until(() => relay.received.some((m) => m.id === 'big'));
    expect(relay.received.some((m) => m.id === 'bin')).toBe(false);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(MAX_FRAME);
    const big = relay.received.find((m) => m.id === 'big') as { ok: boolean; content: { text: string }[] };
    expect(big.ok).toBe(true);
    expect(big.content[0]?.text).toMatch(/truncated by Jarvis/);
    t.app.relay.stop();
  });

  it('resultFrame keeps small results intact and maps errors to { ok: false, error }', () => {
    expect(JSON.parse(resultFrame('a', { content: [{ type: 'text', text: 'hi' }] }))).toEqual({
      type: 'result',
      id: 'a',
      ok: true,
      content: [{ type: 'text', text: 'hi' }],
    });
    expect(JSON.parse(resultFrame('b', { content: [{ type: 'text', text: 'nope' }], isError: true }))).toEqual({
      type: 'result',
      id: 'b',
      ok: false,
      error: 'nope',
    });
    expect(truncateUtf8('a€b', 3)).toBe('a');
  });

  it('base32 encodes RFC 4648 lowercase without padding', () => {
    expect(base32(Buffer.from('foobar'))).toBe('mzxw6ytboi');
  });
});
