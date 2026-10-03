import { SELF } from 'cloudflare:test';
import { base32, pairingCodeFromHash, sha256Hex } from '../src/shared/pairing.js';

export const BASE = 'https://relay.example';
export const REDIRECT_URI = 'https://chatgpt.example/connector/oauth/callback';

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export interface Pair {
  pairId: string;
  secret: string;
  secretHash: string;
  code: string;
}

export async function newPair(): Promise<Pair> {
  const pairId = base32(crypto.getRandomValues(new Uint8Array(16))).toLowerCase();
  const secret = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const secretHash = await sha256Hex(secret);
  return { pairId, secret, secretHash, code: pairingCodeFromHash(secretHash) };
}

export function register(pair: Pick<Pair, 'pairId' | 'secretHash'>, label = "Test's laptop") {
  return SELF.fetch(`${BASE}/pair/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairId: pair.pairId, secretHash: pair.secretHash, label }),
  });
}

export async function registeredPair(): Promise<Pair> {
  const pair = await newPair();
  const res = await register(pair);
  if (res.status !== 201) throw new Error(`register failed: ${res.status}`);
  return pair;
}

/** Opens the desktop link and sends `hello`. Returns the socket and a queue of received frames. */
export async function connectDesktop(pair: Pair, tools: Array<{ name: string; readOnly?: boolean }>) {
  const res = await SELF.fetch(`${BASE}/desktop/connect?pairId=${pair.pairId}`, {
    headers: { Upgrade: 'websocket', Authorization: `Bearer ${pair.secret}` },
  });
  const ws = res.webSocket;
  if (!ws) throw new Error(`no websocket: ${res.status}`);
  ws.accept();
  const frames: Array<Record<string, unknown>> = [];
  const waiters: Array<() => void> = [];
  ws.addEventListener('message', (event) => {
    frames.push(JSON.parse(String(event.data)) as Record<string, unknown>);
    for (const wake of waiters.splice(0)) wake();
  });
  ws.send(JSON.stringify({ type: 'hello', version: '0.1.0', tools }));
  const nextFrame = async (timeoutMs = 2000): Promise<Record<string, unknown>> => {
    const deadline = Date.now() + timeoutMs;
    while (frames.length === 0) {
      if (Date.now() > deadline) throw new Error('no frame received');
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
    return frames.shift() as Record<string, unknown>;
  };
  return { ws, frames, nextFrame };
}

/** Runs the full OAuth flow (DCR → authorize with pairing code → token) and returns an access token. */
export async function oauthClient() {
  const reg = await SELF.fetch(`${BASE}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'ChatGPT',
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  if (reg.status !== 201) throw new Error(`DCR failed: ${reg.status} ${await reg.text()}`);
  const { client_id: clientId } = (await reg.json()) as { client_id: string };
  return { clientId };
}

export async function startAuthorization(clientId: string) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: 'jarvis',
    state: 'state-123',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: `${BASE}/mcp`,
  });
  const res = await SELF.fetch(`${BASE}/authorize?${params}`);
  const html = await res.text();
  const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1] ?? '';
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  return { res, html, handle, cookie, verifier };
}

export function submitCode(auth: { handle: string; cookie: string }, code: string, decision = 'approve') {
  return SELF.fetch(`${BASE}/authorize`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: auth.cookie },
    body: new URLSearchParams({ handle: auth.handle, code, decision }),
  });
}

export async function accessTokenFor(pair: Pair): Promise<string> {
  const { clientId } = await oauthClient();
  const auth = await startAuthorization(clientId);
  const approved = await submitCode(auth, pair.code);
  if (approved.status !== 302) throw new Error(`authorize failed: ${approved.status} ${await approved.text()}`);
  const code = new URL(approved.headers.get('Location') ?? '').searchParams.get('code') ?? '';
  const token = await SELF.fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: auth.verifier,
      resource: `${BASE}/mcp`,
    }),
  });
  if (token.status !== 200) throw new Error(`token failed: ${token.status} ${await token.text()}`);
  return ((await token.json()) as { access_token: string }).access_token;
}

let rpcId = 1;
export async function mcp(token: string, method: string, params?: Record<string, unknown>) {
  const res = await SELF.fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'openai-mcp/1.0',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
  });
  return {
    status: res.status,
    body: (await res.json()) as { result?: any; error?: { code: number; message: string } },
  };
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
