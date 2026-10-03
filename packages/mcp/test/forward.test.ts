import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createSidecarForwarder,
  defaultConnectionFilePath,
  envConnectionSource,
  fileConnectionSource,
  OFFLINE_MESSAGE,
  SidecarClient,
} from '../src/index.js';
import { startFakeSidecar } from './helpers.js';

const TOKEN = 'mcp-token-0123456789abcdef';
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

describe('connection file', () => {
  it('resolves run/agent-host.json in the data dir (JARVIS_DATA_DIR wins)', () => {
    expect(defaultConnectionFilePath('linux', { JARVIS_DATA_DIR: '/tmp/j' }, '/home/u').replaceAll('\\', '/')).toBe(
      '/tmp/j/run/agent-host.json',
    );
  });

  it('reads port and token from disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-mcp-'));
    await mkdir(join(dir, 'run'));
    const file = join(dir, 'run', 'agent-host.json');
    await writeFile(file, JSON.stringify({ port: 1234, mcpToken: 'abc', pid: 1, version: '0.1.0', startedAt: 0 }));
    expect(await fileConnectionSource(file)()).toEqual({ port: 1234, mcpToken: 'abc' });
    expect(await fileConnectionSource(join(dir, 'missing.json'))()).toBeNull();
  });
});

describe('session-token connection source', () => {
  it('uses JARVIS_MCP_PORT + JARVIS_MCP_SESSION_TOKEN when present', async () => {
    expect(await envConnectionSource({ JARVIS_MCP_PORT: '4321', JARVIS_MCP_SESSION_TOKEN: 'sess' })?.()).toEqual({
      port: 4321,
      mcpToken: 'sess',
    });
    expect(envConnectionSource({ JARVIS_MCP_PORT: '4321' })).toBeNull();
    expect(envConnectionSource({ JARVIS_MCP_PORT: 'x', JARVIS_MCP_SESSION_TOKEN: 's' })).toBeNull();
  });
});

describe('forwarding to the sidecar', () => {
  it('connects as role mcp with the token subprotocol and sends mcp.call with origin and client', async () => {
    const sidecar = await startFakeSidecar(TOKEN, () => ({ content: [{ type: 'text', text: 'spoken' }] }));
    cleanups.push(sidecar.close);
    const client = new SidecarClient(async () => ({ port: sidecar.port, mcpToken: TOKEN }));
    cleanups.push(() => client.close());
    const forward = createSidecarForwarder(client, 'stdio');

    const result = await forward('jarvis_speak', { text: 'Hello' }, 'claude-desktop');
    expect(result).toEqual({ content: [{ type: 'text', text: 'spoken' }] });
    expect(sidecar.calls).toEqual([
      {
        protocol: `jarvis.${TOKEN}`,
        method: 'mcp.call',
        params: { tool: 'jarvis_speak', args: { text: 'Hello' }, origin: 'stdio', client: 'claude-desktop' },
      },
    ]);

    // the same socket is reused
    await forward('jarvis_recall', {}, 'claude-desktop');
    expect(sidecar.wss.clients.size).toBe(1);
  });

  it('wraps non-MCP results as text content', async () => {
    const sidecar = await startFakeSidecar(TOKEN, () => ({ sessions: [] }));
    cleanups.push(sidecar.close);
    const client = new SidecarClient(async () => ({ port: sidecar.port, mcpToken: TOKEN }));
    cleanups.push(() => client.close());
    const result = await createSidecarForwarder(client, 'http')('jarvis_list_sessions', {});
    expect(result).toEqual({ content: [{ type: 'text', text: '{"sessions":[]}' }] });
    expect(sidecar.calls[0]?.params.origin).toBe('http');
  });

  it('returns a friendly error when Jarvis is not running (no connection file)', async () => {
    const client = new SidecarClient(async () => null);
    const result = await createSidecarForwarder(client, 'stdio')('jarvis_speak', { text: 'hi' });
    expect(result).toEqual({ isError: true, content: [{ type: 'text', text: OFFLINE_MESSAGE }] });
  });

  it('returns a friendly error when the port refuses connections or the token is wrong', async () => {
    const sidecar = await startFakeSidecar(TOKEN);
    cleanups.push(sidecar.close);
    const wrongToken = new SidecarClient(async () => ({ port: sidecar.port, mcpToken: 'stale-token' }));
    expect((await createSidecarForwarder(wrongToken, 'stdio')('jarvis_recall', {})).isError).toBe(true);

    const port = sidecar.port;
    await sidecar.close();
    cleanups.pop();
    const refused = new SidecarClient(async () => ({ port, mcpToken: TOKEN }));
    const result = await createSidecarForwarder(refused, 'stdio')('jarvis_recall', {});
    expect(result.content[0]).toEqual({ type: 'text', text: OFFLINE_MESSAGE });
  });

  it('reconnects lazily after Jarvis restarts', async () => {
    let sidecar = await startFakeSidecar(TOKEN, () => ({ content: [{ type: 'text', text: 'first' }] }));
    let info = { port: sidecar.port, mcpToken: TOKEN };
    const client = new SidecarClient(async () => info);
    cleanups.push(() => client.close());
    const forward = createSidecarForwarder(client, 'stdio');
    expect((await forward('jarvis_recall', {})).content[0]).toEqual({ type: 'text', text: 'first' });

    await sidecar.close();
    sidecar = await startFakeSidecar('new-token-123', () => ({ content: [{ type: 'text', text: 'second' }] }));
    cleanups.push(sidecar.close);
    info = { port: sidecar.port, mcpToken: 'new-token-123' };
    await new Promise((r) => setTimeout(r, 50));
    expect((await forward('jarvis_recall', {})).content[0]).toEqual({ type: 'text', text: 'second' });
  });

  it('turns JSON-RPC errors into error results', async () => {
    const sidecar = await startFakeSidecar(TOKEN);
    cleanups.push(sidecar.close);
    sidecar.wss.removeAllListeners('connection');
    sidecar.wss.on('connection', (socket) =>
      socket.on('message', (data) => {
        const { id } = JSON.parse(data.toString()) as { id: number };
        socket.send(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32001, message: 'Denied by policy' } }));
      }),
    );
    const client = new SidecarClient(async () => ({ port: sidecar.port, mcpToken: TOKEN }));
    cleanups.push(() => client.close());
    const result = await createSidecarForwarder(client, 'stdio')('jarvis_start_task', { task: 'x' });
    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Jarvis refused the call: Denied by policy' }],
    });
  });

  it('times out when the sidecar never answers', async () => {
    const sidecar = await startFakeSidecar(TOKEN, () => undefined);
    cleanups.push(sidecar.close);
    const client = new SidecarClient(async () => ({ port: sidecar.port, mcpToken: TOKEN }));
    cleanups.push(() => client.close());
    await expect(client.request('mcp.call', {}, 100)).rejects.toThrow(/did not answer/);
  });
});
