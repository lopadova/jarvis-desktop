import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SECRET_KEYS } from '@jarvis/core';
import { afterEach, describe, expect, it } from 'vitest';
import { type WebSocket, WebSocketServer } from 'ws';
import { base32, pairingCode, sha256Hex } from '../src/relay.js';
import { makeApp, until } from './helpers.js';

interface FakeRelay {
  url: string;
  wss: WebSocketServer;
  registered: { pairId: string; secretHash: string; label: string }[];
  sockets: WebSocket[];
  received: Record<string, unknown>[];
  auth: string[];
}

let relays: FakeRelay[] = [];
afterEach(async () => {
  for (const r of relays) await new Promise((res) => r.wss.close(res));
  relays = [];
});

async function fakeRelay(): Promise<FakeRelay> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((r) => wss.once('listening', r));
  const port = (wss.address() as AddressInfo).port;
  const relay: FakeRelay = {
    url: `http://127.0.0.1:${port}`,
    wss,
    registered: [],
    sockets: [],
    received: [],
    auth: [],
  };
  wss.on('connection', (ws, req: IncomingMessage) => {
    relay.auth.push(String(req.headers.authorization));
    relay.sockets.push(ws);
    ws.on('message', (d) => relay.received.push(JSON.parse(d.toString())));
  });
  relays.push(relay);
  return relay;
}

const fakeFetch =
  (relay: FakeRelay, statuses: number[] = [201]) =>
  async (_url: string | URL | Request, init?: RequestInit) => {
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

  it('base32 encodes RFC 4648 lowercase without padding', () => {
    expect(base32(Buffer.from('foobar'))).toBe('mzxw6ytboi');
  });
});
