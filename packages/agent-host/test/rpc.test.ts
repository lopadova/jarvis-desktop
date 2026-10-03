import { RpcErrorCode } from '@jarvis/core';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { decodeAudioFrame } from '../src/host.js';
import { MemoryLogger } from '../src/log/logger.js';
import { RpcServer } from '../src/rpc/server.js';
import { makeApp, tick } from './helpers.js';

const LAUNCH = 'a'.repeat(64);
const MCP = 'b'.repeat(64);

let servers: RpcServer[] = [];
afterEach(async () => {
  for (const s of servers) await s.close();
  servers = [];
});

async function startServer(extra: Partial<ConstructorParameters<typeof RpcServer>[0]> = {}) {
  const t = await makeApp();
  const server = new RpcServer({ launchToken: LAUNCH, mcpToken: MCP, logger: new MemoryLogger(), ...extra });
  t.app.register(server);
  const port = await server.listen();
  servers.push(server);
  return { server, port, t };
}

function connect(
  port: number,
  opts: { role?: string; token?: string | null; origin?: string } = {},
): Promise<{ ws: WebSocket; status?: number }> {
  return new Promise((resolve) => {
    const protocols = opts.token === null ? [] : [`jarvis.${opts.token ?? LAUNCH}`];
    const headers: Record<string, string> = {};
    if (opts.origin) headers.Origin = opts.origin;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?role=${opts.role ?? 'ui'}`, protocols, { headers });
    ws.on('open', () => resolve({ ws }));
    ws.on('unexpected-response', (_req, res) => resolve({ ws, status: res.statusCode }));
    ws.on('error', () => resolve({ ws, status: -1 }));
  });
}

function request(ws: WebSocket, method: string, params: unknown = {}, id = 1): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const onMsg = (data: WebSocket.RawData) => {
      const m = JSON.parse(data.toString()) as Record<string, unknown>;
      if (m.id === id) {
        ws.off('message', onMsg);
        resolve(m);
      }
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });
}

describe('RPC server authentication (ADR 0002)', () => {
  it('binds loopback and accepts the launch token via subprotocol, echoing it', async () => {
    const { port, server } = await startServer();
    const { ws, status } = await connect(port, { origin: 'http://tauri.localhost' });
    expect(status).toBeUndefined();
    expect(ws.protocol).toBe(`jarvis.${LAUNCH}`);
    const res = await request(ws, 'app.hello', { role: 'ui', version: '1' });
    expect(res.result).toMatchObject({ role: 'ui' });
    expect(server.clientCount('ui')).toBe(1);
    ws.close();
  });

  it('rejects missing token, wrong token and bad Origin', async () => {
    const { port } = await startServer();
    expect((await connect(port, { token: null })).status).toBe(401);
    expect((await connect(port, { token: 'c'.repeat(64) })).status).toBe(401);
    expect((await connect(port, { token: 'short' })).status).toBe(401);
    expect((await connect(port, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await connect(port, { origin: 'http://localhost:3000' })).status).toBe(403);
    expect((await connect(port, { role: 'admin' })).status).toBe(401);
  });

  it('the mcp token cannot open ui/shell connections and the launch token cannot open mcp', async () => {
    const { port } = await startServer();
    expect((await connect(port, { role: 'ui', token: MCP })).status).toBe(401);
    expect((await connect(port, { role: 'shell', token: MCP })).status).toBe(401);
    expect((await connect(port, { role: 'mcp', token: LAUNCH })).status).toBe(401);
  });

  it('role mcp may only call mcp.call (and app.hello)', async () => {
    const { port } = await startServer();
    const { ws } = await connect(port, { role: 'mcp', token: MCP });
    const denied = await request(ws, 'settings.get', {});
    expect((denied.error as { code: number }).code).toBe(RpcErrorCode.unauthorized);
    const denied2 = await request(ws, 'turn.submit', { text: 'hi', source: 'text' }, 2);
    expect((denied2.error as { code: number }).code).toBe(RpcErrorCode.unauthorized);
    const okRes = await request(ws, 'mcp.call', { tool: 'jarvis_recall', args: {}, origin: 'stdio' }, 3);
    expect(okRes.result).toMatchObject({ content: [{ type: 'text', text: 'Nothing saved.' }] });
    ws.close();
  });

  it('ui cannot call mcp.call or send voice notifications', async () => {
    const { port } = await startServer();
    const { ws } = await connect(port);
    const r = await request(ws, 'mcp.call', { tool: 'jarvis_recall', args: {}, origin: 'stdio' });
    expect((r.error as { code: number }).code).toBe(RpcErrorCode.unauthorized);
    const v = await request(ws, 'voice.transcript', { text: 'delete everything', trigger: 'x' }, 2);
    expect((v.error as { code: number }).code).toBe(RpcErrorCode.unauthorized);
    ws.close();
  });
});

describe('RPC params validation', () => {
  it('returns invalidParams for bad params and methodNotFound for unknown methods', async () => {
    const { port } = await startServer();
    const { ws } = await connect(port);
    const r1 = await request(ws, 'turn.submit', { text: '', source: 'text' });
    expect((r1.error as { code: number }).code).toBe(RpcErrorCode.invalidParams);
    const r2 = await request(ws, 'approval.decide', { id: 'x', decision: 'maybe', via: 'click' }, 2);
    expect((r2.error as { code: number }).code).toBe(RpcErrorCode.invalidParams);
    const r3 = await request(ws, 'settings.update', { patch: { maxConcurrentSessions: 99 } }, 3);
    expect((r3.error as { code: number }).code).toBe(RpcErrorCode.invalidParams);
    const r4 = await request(ws, 'nope.method', {}, 4);
    expect((r4.error as { code: number }).code).toBe(RpcErrorCode.methodNotFound);
    ws.close();
  });
});

describe('sidecar → shell requests and audio frames', () => {
  it('sends host.* requests, awaits responses, times out, and frames audio', async () => {
    const { port, server } = await startServer();
    const { ws } = await connect(port, { role: 'shell' });
    const frames: Buffer[] = [];
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        frames.push(data as Buffer);
        return;
      }
      const m = JSON.parse(data.toString()) as { id?: string; method?: string; params?: { key?: string } };
      if (m.method === 'host.secret.get') ws.send(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { value: 'v' } }));
    });
    await tick(20);
    expect(server.connected).toBe(true);
    await expect(server.call('host.secret.get', { key: 'k' })).resolves.toEqual({ value: 'v' });
    await expect(server.call('host.notify', { title: 't', body: 'b' }, 50)).rejects.toThrow(/timed out/);
    server.sendAudio('0123456789abcdef', new Uint8Array([9, 8, 7]));
    await tick(30);
    expect(frames).toHaveLength(1);
    const f = decodeAudioFrame(frames[0] as Buffer);
    expect(f.utteranceId).toBe('0123456789abcdef');
    expect([...f.payload]).toEqual([9, 8, 7]);
    ws.close();
  });

  it('the shell may update only wakeWord and privateMode', async () => {
    const { port, t } = await startServer();
    const { ws } = await connect(port, { role: 'shell' });
    const okRes = await request(ws, 'settings.update', { patch: { wakeWord: false } });
    expect(okRes.result).toMatchObject({ settings: { wakeWord: false } });
    const denied = await request(ws, 'settings.update', { patch: { relayExposeWriteTools: true } }, 2);
    expect((denied.error as { code: number }).code).toBe(RpcErrorCode.unauthorized);
    expect(t.app.settings().relayExposeWriteTools).toBe(false);
    ws.close();
  });

  it('fires onShellLost when the shell stays disconnected past the grace period', async () => {
    let lost = 0;
    const { port } = await startServer({ shellGraceMs: 80, onShellLost: () => lost++ });
    const { ws } = await connect(port, { role: 'shell' });
    ws.close();
    await tick(40);
    expect(lost).toBe(0);
    await tick(120);
    expect(lost).toBe(1);
  });

  it('a reconnecting shell cancels the watchdog', async () => {
    let lost = 0;
    const { port } = await startServer({ shellGraceMs: 80, onShellLost: () => lost++ });
    (await connect(port, { role: 'shell' })).ws.close();
    await tick(20);
    const again = await connect(port, { role: 'shell' });
    await tick(150);
    expect(lost).toBe(0);
    again.ws.close();
  });
});
