import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { OFFLINE_TEXT } from '../src/shared/mcp.js';
import { base32, normalizePairingCode, pairingCodeFromHash } from '../src/shared/pairing.js';
import {
  accessTokenFor,
  BASE,
  connectDesktop,
  mcp,
  newPair,
  oauthClient,
  register,
  registeredPair,
  sleep,
  startAuthorization,
  submitCode,
} from './helpers.js';

describe('pairing primitives', () => {
  it('base32 matches RFC 4648 test vectors', () => {
    const enc = (s: string) => base32(new TextEncoder().encode(s));
    expect(enc('f')).toBe('MY');
    expect(enc('foobar')).toBe('MZXW6YTBOI');
  });

  it('derives the 8-char pairing code from the secret hash and normalises typed input', () => {
    expect(pairingCodeFromHash('00'.repeat(32))).toBe('AAAAAAAA');
    expect(normalizePairingCode('abcd-ef23')).toBe('ABCDEF23');
    expect(normalizePairingCode('abcd ef1')).toBeNull();
  });
});

describe('POST /pair/register', () => {
  it('registers a pair (201), then rejects the same pairId (409)', async () => {
    const pair = await newPair();
    expect((await register(pair)).status).toBe(201);
    expect((await register(pair)).status).toBe(409);
  });

  it('rejects malformed bodies', async () => {
    const res = await register({ pairId: 'NOT-BASE32', secretHash: 'zz' });
    expect(res.status).toBe(400);
  });

  it('adds security headers', async () => {
    const res = await SELF.fetch(`${BASE}/`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });
});

describe('GET /desktop/connect', () => {
  it('rejects a wrong secret with 401', async () => {
    const pair = await registeredPair();
    const res = await SELF.fetch(`${BASE}/desktop/connect?pairId=${pair.pairId}`, {
      headers: { Upgrade: 'websocket', Authorization: 'Bearer wrong-secret' },
    });
    expect(res.status).toBe(401);
    expect(res.webSocket).toBeNull();
  });

  it('rejects an unknown pair with the same 401', async () => {
    const pair = await newPair();
    const res = await SELF.fetch(`${BASE}/desktop/connect?pairId=${pair.pairId}`, {
      headers: { Upgrade: 'websocket', Authorization: `Bearer ${pair.secret}` },
    });
    expect(res.status).toBe(401);
  });

  it('accepts the right secret and answers pings', async () => {
    const pair = await registeredPair();
    const desktop = await connectDesktop(pair, []);
    desktop.ws.send(JSON.stringify({ type: 'ping', t: 42 }));
    expect(await desktop.nextFrame()).toEqual({ type: 'pong', t: 42 });
    desktop.ws.close();
  });
});

describe('OAuth', () => {
  it('publishes protected-resource and authorization-server metadata', async () => {
    const prm = (await (await SELF.fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)).json()) as {
      resource: string;
    };
    expect(prm.resource).toBe(`${BASE}/mcp`);
    const as = (await (await SELF.fetch(`${BASE}/.well-known/oauth-authorization-server`)).json()) as {
      registration_endpoint: string;
    };
    expect(as.registration_endpoint).toBe(`${BASE}/oauth/register`);
  });

  it('challenges unauthenticated /mcp requests with 401', async () => {
    const res = await SELF.fetch(`${BASE}/mcp`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata');
  });

  it('shows an accessible pairing-code form', async () => {
    const { clientId } = await oauthClient();
    const auth = await startAuthorization(clientId);
    expect(auth.res.status).toBe(200);
    expect(auth.html).toContain('<label for="code">Pairing code</label>');
    expect(auth.handle).not.toBe('');
  });

  it('rejects a wrong pairing code and keeps the form usable', async () => {
    const pair = await registeredPair();
    const { clientId } = await oauthClient();
    const auth = await startAuthorization(clientId);
    const wrong = await submitCode(auth, pair.code === 'AAAAAAAA' ? 'BBBBBBBB' : 'AAAAAAAA');
    expect(wrong.status).toBe(400);
    expect(await wrong.text()).toContain('role="alert"');
    // the same consent handle still works with the right code
    const right = await submitCode(auth, pair.code);
    expect(right.status).toBe(302);
    expect(new URL(right.headers.get('Location') ?? '').searchParams.get('state')).toBe('state-123');
  });

  it('redirects with access_denied when the user cancels', async () => {
    const { clientId } = await oauthClient();
    const auth = await startAuthorization(clientId);
    const res = await submitCode(auth, '', 'deny');
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('Location') ?? '').searchParams.get('error')).toBe('access_denied');
  });
});

describe('/mcp', () => {
  it('initializes and answers ping', async () => {
    const token = await accessTokenFor(await registeredPair());
    const init = await mcp(token, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'chatgpt', version: '1' },
    });
    expect(init.body.result.protocolVersion).toBe('2025-06-18');
    expect(init.body.result.capabilities.tools).toBeDefined();
    expect((await mcp(token, 'ping')).body.result).toEqual({});
  });

  it('tools/list reflects the desktop hello with annotations from core', async () => {
    const pair = await registeredPair();
    const token = await accessTokenFor(pair);
    expect((await mcp(token, 'tools/list')).body.result.tools).toEqual([]);

    const desktop = await connectDesktop(pair, [
      { name: 'jarvis_list_sessions', readOnly: true },
      { name: 'jarvis_speak', readOnly: false },
      { name: 'not_a_jarvis_tool' },
    ]);
    await sleep(50);
    const tools = (await mcp(token, 'tools/list')).body.result.tools as Array<{
      name: string;
      annotations: { readOnlyHint: boolean; destructiveHint: boolean };
      inputSchema: { type: string };
    }>;
    expect(tools.map((t) => t.name)).toEqual(['jarvis_speak', 'jarvis_list_sessions']);
    expect(tools.find((t) => t.name === 'jarvis_list_sessions')?.annotations.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'jarvis_speak')?.annotations.readOnlyHint).toBe(false);
    expect(tools[0]?.inputSchema.type).toBe('object');
    desktop.ws.close();
  });

  it('round-trips tools/call through the desktop socket', async () => {
    const pair = await registeredPair();
    const token = await accessTokenFor(pair);
    const desktop = await connectDesktop(pair, [{ name: 'jarvis_list_sessions', readOnly: true }]);
    await sleep(50);

    const pending = mcp(token, 'tools/call', { name: 'jarvis_list_sessions', arguments: {} });
    const call = await desktop.nextFrame();
    expect(call).toMatchObject({ type: 'call', tool: 'jarvis_list_sessions', args: {}, client: 'chatgpt' });
    desktop.ws.send(
      JSON.stringify({ type: 'result', id: call.id, ok: true, content: [{ type: 'text', text: 'No sessions' }] }),
    );
    const { body } = await pending;
    expect(body.result).toEqual({ content: [{ type: 'text', text: 'No sessions' }] });

    const failing = mcp(token, 'tools/call', { name: 'jarvis_list_sessions', arguments: {} });
    const call2 = await desktop.nextFrame();
    desktop.ws.send(JSON.stringify({ type: 'result', id: call2.id, ok: false, error: 'Denied by user' }));
    expect((await failing).body.result).toEqual({ content: [{ type: 'text', text: 'Denied by user' }], isError: true });
    desktop.ws.close();
  });

  it('rejects tools the desktop did not expose', async () => {
    const pair = await registeredPair();
    const token = await accessTokenFor(pair);
    const desktop = await connectDesktop(pair, [{ name: 'jarvis_recall', readOnly: true }]);
    await sleep(50);
    const res = await mcp(token, 'tools/call', { name: 'jarvis_start_task', arguments: { task: 'rm -rf /' } });
    expect(res.body.error?.code).toBe(-32602);
    desktop.ws.close();
  });

  it('times out when the desktop never answers', async () => {
    const pair = await registeredPair();
    const token = await accessTokenFor(pair);
    const desktop = await connectDesktop(pair, [{ name: 'jarvis_recall', readOnly: true }]);
    await sleep(50);
    const { body } = await mcp(token, 'tools/call', { name: 'jarvis_recall', arguments: {} });
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/did not answer/);
    desktop.ws.close();
  });

  it('returns the offline error when no desktop is connected', async () => {
    const pair = await registeredPair();
    const token = await accessTokenFor(pair);
    const desktop = await connectDesktop(pair, [{ name: 'jarvis_recall', readOnly: true }]);
    await sleep(50);
    desktop.ws.close();
    await sleep(100);
    const { body } = await mcp(token, 'tools/call', { name: 'jarvis_recall', arguments: {} });
    expect(body.result).toEqual({ content: [{ type: 'text', text: OFFLINE_TEXT }], isError: true });
  });

  it('rate limits calls per pair (CALLS_PER_MINUTE, 60 in production)', async () => {
    const pair = await registeredPair();
    const link = env.DESKTOP_LINK.get(env.DESKTOP_LINK.idFromName(pair.pairId));
    const results: unknown[] = [];
    for (let i = 0; i < 6; i++) results.push(await link.callTool('jarvis_recall', {}, 'test'));
    expect(results.slice(0, 5).every((r) => JSON.stringify(r).includes(OFFLINE_TEXT))).toBe(true);
    expect(JSON.stringify(results[5])).toContain('Too many calls');
  });

  it('closes the desktop socket on frames over 64 KB', async () => {
    const pair = await registeredPair();
    const desktop = await connectDesktop(pair, []);
    const closed = new Promise<number>((resolve) => desktop.ws.addEventListener('close', (e) => resolve(e.code)));
    desktop.ws.send(JSON.stringify({ type: 'ping', t: 1, pad: 'x'.repeat(70 * 1024) }));
    expect(await closed).toBe(1009);
  });
});

describe('unpairing', () => {
  const unpair = (pair: { pairId: string; secret: string }, secret = pair.secret) =>
    SELF.fetch(`${BASE}/pair/register?pairId=${pair.pairId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${secret}` },
    });

  it('requires the pair secret', async () => {
    const pair = await registeredPair();
    expect((await unpair(pair, 'wrong')).status).toBe(401);
  });

  it('revokes every OAuth grant of the pair', async () => {
    const pair = await registeredPair();
    const first = await accessTokenFor(pair);
    const second = await accessTokenFor(pair);
    expect((await mcp(first, 'ping')).status).toBe(200);
    expect((await unpair(pair)).status).toBe(204);
    for (const token of [first, second]) {
      const res = await SELF.fetch(`${BASE}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      });
      expect(res.status).toBe(401);
    }
  });

  it('tombstones the pairId so it cannot be registered again', async () => {
    const pair = await registeredPair();
    expect((await unpair(pair)).status).toBe(204);
    expect((await register(pair)).status).toBe(409);
    const desktop = await SELF.fetch(`${BASE}/desktop/connect?pairId=${pair.pairId}`, {
      headers: { Upgrade: 'websocket', Authorization: `Bearer ${pair.secret}` },
    });
    expect(desktop.status).toBe(401);
  });

  it('rejects a grant issued for an earlier registration (generation check)', async () => {
    const pair = await registeredPair();
    const token = await accessTokenFor(pair);
    // Simulate the pair's Durable Object now belonging to a different registration.
    await env.DESKTOP_LINK.get(env.DESKTOP_LINK.idFromName(pair.pairId)).activate('another-registration');
    const res = await SELF.fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('invalid_token');
  });
});
