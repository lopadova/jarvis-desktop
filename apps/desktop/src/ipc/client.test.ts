import { describe, expect, it, vi } from 'vitest';
import { backoffDelay, RpcClient, RpcError, type SocketLike, subprotocolFor } from './client';

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: unknown[] = [];
  closed = false;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {}
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({});
  }
}

function setup(endpoints = [{ port: 4100, token: 'tok1' }]) {
  const sockets: FakeSocket[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  let i = 0;
  const client = new RpcClient({
    endpoint: async () => endpoints[Math.min(i++, endpoints.length - 1)] as { port: number; token: string },
    socketFactory: (url, protocols) => {
      const s = new FakeSocket(url, protocols);
      sockets.push(s);
      return s;
    },
    setTimer: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => {
      const idx = timers.indexOf(h as (typeof timers)[number]);
      if (idx >= 0) timers.splice(idx, 1);
    },
  });
  return { client, sockets, timers };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('RpcClient', () => {
  it('connects as role ui with the jarvis.<token> subprotocol', async () => {
    const { client, sockets } = setup();
    client.start();
    await flush();
    expect(sockets[0]?.url).toBe('ws://127.0.0.1:4100/?role=ui');
    expect(sockets[0]?.protocols).toEqual([subprotocolFor('tok1')]);
    expect(subprotocolFor('abc')).toBe('jarvis.abc');
  });

  it('correlates responses and surfaces RPC errors', async () => {
    const { client, sockets } = setup();
    const statuses: string[] = [];
    client.onStatus((s) => statuses.push(s));
    client.start();
    await flush();
    const s = sockets[0] as FakeSocket;
    s.open();
    expect(statuses).toEqual(['closed', 'connecting', 'open']);

    const ok = client.call('app.state', {});
    const bad = client.call('session.stop', { id: 'x' });
    expect(s.sent).toEqual([
      { jsonrpc: '2.0', id: 1, method: 'app.state', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'session.stop', params: { id: 'x' } },
    ]);
    s.receive({ jsonrpc: '2.0', id: 2, error: { code: -32602, message: 'bad id' } });
    s.receive({ jsonrpc: '2.0', id: 1, result: { version: '1' } });
    await expect(ok).resolves.toEqual({ version: '1' });
    await expect(bad).rejects.toMatchObject({ code: -32602, message: 'bad id' });
  });

  it('dispatches notifications and ignores garbage', async () => {
    const { client, sockets } = setup();
    const seen = vi.fn();
    client.onNotification(seen);
    client.start();
    await flush();
    const s = sockets[0] as FakeSocket;
    s.open();
    s.onmessage?.({ data: 'not json' });
    s.receive({ jsonrpc: '2.0', method: 'ui.pill', params: { state: { kind: 'hidden' }, privateMode: false } });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith('ui.pill', { state: { kind: 'hidden' }, privateMode: false });
  });

  it('rejects calls when not connected', async () => {
    const { client } = setup();
    await expect(client.call('app.state', {})).rejects.toBeInstanceOf(RpcError);
  });

  it('fails pending calls on disconnect and reconnects with a fresh endpoint and backoff', async () => {
    const { client, sockets, timers } = setup([
      { port: 4100, token: 'tok1' },
      { port: 4200, token: 'tok2' },
    ]);
    client.start();
    await flush();
    const first = sockets[0] as FakeSocket;
    first.open();
    const pending = client.call('app.state', {});
    first.drop();
    await expect(pending).rejects.toMatchObject({ message: 'connection closed' });
    const reconnect = timers.find((t) => t.ms === 500);
    expect(reconnect).toBeDefined();
    reconnect?.fn();
    await flush();
    expect(sockets[1]?.url).toBe('ws://127.0.0.1:4200/?role=ui');
    expect(sockets[1]?.protocols).toEqual(['jarvis.tok2']);
  });

  it('times out calls', async () => {
    const { client, sockets, timers } = setup();
    client.start();
    await flush();
    (sockets[0] as FakeSocket).open();
    const p = client.call('app.state', {});
    timers.find((t) => t.ms === 15_000)?.fn();
    await expect(p).rejects.toMatchObject({ message: 'timeout: app.state' });
  });

  it('stop() closes the socket and stops reconnecting', async () => {
    const { client, sockets, timers } = setup();
    client.start();
    await flush();
    client.stop();
    expect(sockets[0]?.closed).toBe(true);
    expect(timers).toHaveLength(0);
  });

  it('backoff is exponential and capped', () => {
    expect([0, 1, 2, 3, 10].map((a) => backoffDelay(a, 500, 10_000))).toEqual([500, 1000, 2000, 4000, 10_000]);
  });
});
