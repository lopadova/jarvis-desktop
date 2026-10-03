import { afterEach, describe, expect, it } from 'vitest';
import { createHttpMcpServer, type Forward, type HttpMcpServer } from '../src/index.js';

const TOKEN = 'a'.repeat(40);
let http: HttpMcpServer | undefined;
afterEach(async () => {
  await http?.close();
  http = undefined;
});

const calls: Parameters<Forward>[] = [];
const forward: Forward = async (...args) => {
  calls.push(args);
  return { content: [{ type: 'text', text: 'ok' }] };
};

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
};

function post(body: unknown, headers: Record<string, string> = {}) {
  return fetch(http?.url ?? '', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${TOKEN}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe('HTTP MCP endpoint', () => {
  it('refuses short tokens', async () => {
    await expect(createHttpMcpServer({ port: 0, bearerToken: 'short', forward })).rejects.toThrow();
  });

  it('binds to loopback', async () => {
    http = await createHttpMcpServer({ port: 0, bearerToken: TOKEN, forward });
    expect(http.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  });

  it('rejects a missing or wrong bearer token with 401', async () => {
    http = await createHttpMcpServer({ port: 0, bearerToken: TOKEN, forward });
    const missing = await post(initialize, { Authorization: '' });
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toMatch(/^Bearer/);
    expect((await post(initialize, { Authorization: `Bearer ${'b'.repeat(40)}` })).status).toBe(401);
  });

  it('rejects requests from a non-allow-listed browser Origin', async () => {
    http = await createHttpMcpServer({
      port: 0,
      bearerToken: TOKEN,
      forward,
      allowedOrigins: ['https://allowed.example'],
    });
    expect((await post(initialize, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(initialize, { Origin: 'https://allowed.example' })).status).toBe(200);
  });

  it('serves initialize, tools/list and tools/call with JSON responses', async () => {
    http = await createHttpMcpServer({ port: 0, bearerToken: TOKEN, forward });
    const init = await post(initialize);
    expect(init.status).toBe(200);
    expect(((await init.json()) as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe('jarvis');

    const list = (await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()) as {
      result: { tools: unknown[] };
    };
    expect(list.result.tools.length).toBe(8);

    calls.length = 0;
    const call = (await (
      await post(
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'jarvis_speak', arguments: { text: 'Hi' } } },
        { 'User-Agent': 'local-agent/1.0' },
      )
    ).json()) as { result: { content: unknown[] } };
    expect(call.result.content).toEqual([{ type: 'text', text: 'ok' }]);
    expect(calls).toEqual([['jarvis_speak', { text: 'Hi' }, 'local-agent/1.0']]);
  });

  it('accepts the token as a path segment only when allowPathToken is set', async () => {
    http = await createHttpMcpServer({ port: 0, bearerToken: TOKEN, forward });
    const noAuth = { Authorization: '' };
    expect((await fetch(`${http.url}/${TOKEN}`, { method: 'POST', headers: noAuth, body: '{}' })).status).toBe(404);
    await http.close();

    http = await createHttpMcpServer({ port: 0, bearerToken: TOKEN, forward, allowPathToken: true });
    const ok = await fetch(`${http.url}/${TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify(initialize),
    });
    expect(ok.status).toBe(200);
    const wrong = await fetch(`${http.url}/${'c'.repeat(40)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify(initialize),
    });
    expect(wrong.status).toBe(401);
  });

  it('answers 404 elsewhere and 405 for GET', async () => {
    http = await createHttpMcpServer({ port: 0, bearerToken: TOKEN, forward });
    const base = http.url.replace(/\/mcp$/, '');
    expect((await fetch(`${base}/other`, { headers: { Authorization: `Bearer ${TOKEN}` } })).status).toBe(404);
    expect((await fetch(http.url, { headers: { Authorization: `Bearer ${TOKEN}` } })).status).toBe(405);
  });
});
