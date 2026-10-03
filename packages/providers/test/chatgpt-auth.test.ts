import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ProviderError, SECRET_KEYS } from '@jarvis/core';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ChatGptPlanAuth, type ChatGptTokenRecord } from '../src/auth/chatgpt-auth.js';
import { codeChallengeS256, createCodeVerifier, createPkceSession, randomToken, safeEqual } from '../src/auth/pkce.js';
import { makeDeps } from './helpers.js';

// ───────────────────────── PKCE / state / nonce ─────────────────────────

describe('pkce', () => {
  it('matches the RFC 7636 S256 test vector', () => {
    expect(codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('creates high-entropy base64url verifiers, states and nonces', () => {
    const v = createCodeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const s = createPkceSession();
    expect(s.challenge).toBe(codeChallengeS256(s.verifier));
    expect(s.state).not.toBe(s.nonce);
    expect(new Set(Array.from({ length: 50 }, randomToken)).size).toBe(50);
  });

  it('compares state/nonce safely', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual(null, 'abc')).toBe(false);
  });
});

// ───────────────────────── mock authorization server ─────────────────────────

interface MockAs {
  base: string;
  issued: string;
  tokenRequests: URLSearchParams[];
  revoked: URLSearchParams[];
  authorizeUrls: URL[];
  /** Overrides for the next ID token. */
  idTokenOverrides: { nonce?: string; aud?: string; iss?: string; expSec?: number };
  refreshError?: { status: number; body: unknown };
  close(): Promise<void>;
  /** Simulates the browser: user approves, the AS redirects to the loopback. */
  browser(opts?: { tamperState?: boolean; omitClientId?: boolean }): (url: string) => Promise<void>;
}

let keys: { privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey']; jwk: Record<string, unknown> };

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  keys = { privateKey, jwk: { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' } };
});

async function startMockAs(): Promise<MockAs> {
  const state = {
    tokenRequests: [] as URLSearchParams[],
    revoked: [] as URLSearchParams[],
    authorizeUrls: [] as URL[],
    codes: new Map<string, { nonce: string; clientId: string; redirectUri: string }>(),
    refreshCounter: 0,
  };
  const issued = 'oaiapp_test123';
  let base = '';
  const mock: Partial<MockAs> = {};

  const idToken = async (aud: string, nonce?: string) => {
    const o = mock.idTokenOverrides ?? {};
    const jwt = new SignJWT({
      email: 'user@example.com',
      ...((o.nonce ?? nonce) ? { nonce: o.nonce ?? nonce } : {}),
      'https://api.openai.com/auth': { chatgpt_plan_type: 'plus' },
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setSubject('user-sub-1')
      .setIssuer(o.iss ?? base)
      .setAudience(o.aud ?? aud)
      .setIssuedAt()
      .setExpirationTime(o.expSec ?? Math.floor(Date.now() / 1000) + 3600);
    return jwt.sign(keys.privateKey);
  };

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', base);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const form = new URLSearchParams(Buffer.concat(chunks).toString());
    const send = (status: number, body: unknown) =>
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (url.pathname === '/.well-known/jwks.json') return send(200, { keys: [keys.jwk] });
    if (url.pathname === '/.well-known/openid-configuration')
      return send(200, { issuer: base, revocation_endpoint: `${base}/oauth/revoke` });
    if (url.pathname === '/oauth/revoke') {
      state.revoked.push(form);
      return res.writeHead(200).end();
    }
    if (url.pathname === '/api/accounts/oauth/token') {
      state.tokenRequests.push(form);
      if (form.get('grant_type') === 'authorization_code') {
        const c = state.codes.get(form.get('code') ?? '');
        if (!c || c.clientId !== form.get('client_id') || c.redirectUri !== form.get('redirect_uri')) {
          return send(400, { error: 'invalid_grant', error_description: 'code/client/redirect mismatch' });
        }
        return send(200, {
          access_token: 'at-1',
          refresh_token: 'rt-1',
          id_token: await idToken(c.clientId, c.nonce),
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
        });
      }
      if (form.get('grant_type') === 'refresh_token') {
        if (mock.refreshError) return send(mock.refreshError.status, mock.refreshError.body);
        const n = ++state.refreshCounter;
        return send(200, {
          access_token: `at-r${n}`,
          refresh_token: `rt-r${n}`,
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }
    }
    send(404, { error: 'not_found' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  Object.assign(mock, {
    base,
    issued,
    tokenRequests: state.tokenRequests,
    revoked: state.revoked,
    authorizeUrls: state.authorizeUrls,
    idTokenOverrides: {},
    close: () => new Promise<void>((r) => server.close(() => r())),
    browser:
      (opts: { tamperState?: boolean; omitClientId?: boolean } = {}) =>
      async (authorizeUrl: string) => {
        const u = new URL(authorizeUrl);
        state.authorizeUrls.push(u);
        const redirect = u.searchParams.get('redirect_uri') as string;
        const code = `code-${state.codes.size + 1}`;
        state.codes.set(code, {
          nonce: u.searchParams.get('nonce') as string,
          clientId: issued,
          redirectUri: redirect,
        });
        const cb = new URL(redirect);
        cb.searchParams.set('code', code);
        cb.searchParams.set('state', opts.tamperState ? 'forged-state' : (u.searchParams.get('state') as string));
        if (!opts.omitClientId) cb.searchParams.set('client_id', issued);
        // Fire the redirect like a browser would (don't block openUrl on it).
        void fetch(cb).then((r) => r.text());
      },
  });
  return mock as MockAs;
}

describe('ChatGptPlanAuth — Sign in with ChatGPT (token sharing)', () => {
  let as: MockAs | undefined;
  afterEach(async () => {
    await as?.close();
    as = undefined;
  });

  const setup = async (now?: () => number) => {
    as = await startMockAs();
    const mock = as;
    let opener: (url: string) => Promise<void> = mock.browser();
    const { deps, secrets } = makeDeps({ openUrl: (u) => opener(u) });
    const auth = new ChatGptPlanAuth(deps, {
      authBase: mock.base,
      ports: [0],
      callbackTimeoutMs: 5000,
      ...(now ? { now } : {}),
    });
    return { as: mock, auth, secrets, setOpener: (f: (u: string) => Promise<void>) => (opener = f) };
  };

  it('registers on first sign-in, exchanges the code with the issued client id and validates the ID token', async () => {
    const { as, auth, secrets } = await setup();
    const result = await auth.signIn();
    expect(result).toEqual({ account: 'user@example.com', plan: 'plus' });

    const q = as.authorizeUrls[0]?.searchParams as URLSearchParams;
    expect(q.get('client_id')).toBe('dynamic_agent_client');
    expect(q.get('agent_name_hint')).toBe('Jarvis Desktop');
    expect(q.get('ext_agent_host_id')).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
    expect(q.get('response_type')).toBe('code');
    expect(q.get('scope')).toBe('openid profile email offline_access resource.invoke chatgpt.tokens.use.direct');
    expect(q.get('resource')).toBe('https://api.openai.com/v1');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
    expect(q.get('state')?.length).toBeGreaterThanOrEqual(43);
    expect(q.get('nonce')?.length).toBeGreaterThanOrEqual(43);

    const tr = as.tokenRequests[0] as URLSearchParams;
    expect(tr.get('grant_type')).toBe('authorization_code');
    expect(tr.get('client_id')).toBe('oaiapp_test123');
    expect(tr.get('redirect_uri')).toBe(q.get('redirect_uri'));
    expect(tr.get('resource')).toBe('https://api.openai.com/v1');
    expect(codeChallengeS256(tr.get('code_verifier') as string)).toBe(q.get('code_challenge'));

    const tokens = JSON.parse(secrets.map.get(SECRET_KEYS.chatgptTokens) as string) as ChatGptTokenRecord;
    expect(tokens).toMatchObject({
      access_token: 'at-1',
      refresh_token: 'rt-1',
      client_id: 'oaiapp_test123',
      subject: 'user-sub-1',
    });
    const client = JSON.parse(secrets.map.get(SECRET_KEYS.chatgptClient) as string);
    expect(client.client_id).toBe('oaiapp_test123');
    expect(client.ext_agent_host_id).toBe(q.get('ext_agent_host_id'));
    expect(await auth.isSignedIn()).toBe(true);
    expect(await auth.getAccessToken()).toBe('at-1');
  });

  it('reuses the issued client id and host id on later sign-ins (no dynamic registration)', async () => {
    const { as, auth } = await setup();
    await auth.signIn();
    await auth.signIn();
    const first = as.authorizeUrls[0]?.searchParams as URLSearchParams;
    const second = as.authorizeUrls[1]?.searchParams as URLSearchParams;
    expect(second.get('client_id')).toBe('oaiapp_test123');
    expect(second.get('agent_name_hint')).toBeNull();
    expect(second.get('id_token_hint')).toBeTruthy();
    expect(second.get('state')).not.toBe(first.get('state'));
    expect(second.get('nonce')).not.toBe(first.get('nonce'));
  });

  it('rejects a callback whose state does not match', async () => {
    const { as, auth, secrets, setOpener } = await setup();
    setOpener(as.browser({ tamperState: true }));
    await expect(auth.signIn()).rejects.toThrow(/state mismatch/);
    expect(as.tokenRequests).toHaveLength(0);
    expect(secrets.map.has(SECRET_KEYS.chatgptTokens)).toBe(false);
  });

  it('rejects an ID token whose nonce does not match', async () => {
    const { as, auth, secrets } = await setup();
    as.idTokenOverrides.nonce = 'some-other-nonce';
    const err = await auth.signIn().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as Error).message).toMatch(/nonce/);
    expect(secrets.map.has(SECRET_KEYS.chatgptTokens)).toBe(false);
  });

  it('rejects an ID token with the wrong audience or issuer', async () => {
    const { as, auth } = await setup();
    as.idTokenOverrides.aud = 'oaiapp_someone_else';
    await expect(auth.signIn()).rejects.toThrow(/ID token validation failed/);
    as.idTokenOverrides = { iss: 'https://evil.example' };
    await expect(auth.signIn()).rejects.toThrow(/ID token validation failed/);
  });

  it('fails when the first registration callback carries no issued client id', async () => {
    const { as, auth, setOpener } = await setup();
    setOpener(as.browser({ omitClientId: true }));
    await expect(auth.signIn()).rejects.toThrow(/issued client id/);
  });

  it('falls back to another loopback port when the preferred one is busy', async () => {
    as = await startMockAs();
    const busy = createServer();
    await new Promise<void>((r) => busy.listen(0, '127.0.0.1', () => r()));
    const busyPort = (busy.address() as AddressInfo).port;
    const { deps } = makeDeps({ openUrl: (as as MockAs).browser() });
    const auth = new ChatGptPlanAuth(deps, { authBase: as.base, ports: [busyPort, 0] });
    try {
      await auth.signIn();
      const redirect = new URL(as.authorizeUrls[0]?.searchParams.get('redirect_uri') as string);
      expect(Number(redirect.port)).not.toBe(busyPort);
      expect(as.tokenRequests[0]?.get('redirect_uri')).toBe(redirect.href);
    } finally {
      busy.close();
    }
  });

  it('refreshes proactively before expiry and rotates the refresh token', async () => {
    let now = Date.now();
    const { as, auth, secrets } = await setup(() => now);
    await auth.signIn();
    expect(await auth.getAccessToken()).toBe('at-1'); // fresh: no refresh
    expect(as.tokenRequests).toHaveLength(1);

    now += 56 * 60_000; // within the 5-minute skew window
    const [a, b] = await Promise.all([auth.getAccessToken(), auth.getAccessToken()]);
    expect(a).toBe('at-r1');
    expect(b).toBe('at-r1'); // concurrent callers share one refresh
    const refresh = as.tokenRequests[1] as URLSearchParams;
    expect(as.tokenRequests).toHaveLength(2);
    expect(refresh.get('grant_type')).toBe('refresh_token');
    expect(refresh.get('client_id')).toBe('oaiapp_test123');
    expect(refresh.get('refresh_token')).toBe('rt-1');
    expect(refresh.get('resource')).toBe('https://api.openai.com/v1');
    expect(refresh.get('scope')).toBeNull();
    let stored = JSON.parse(secrets.map.get(SECRET_KEYS.chatgptTokens) as string) as ChatGptTokenRecord;
    expect(stored.refresh_token).toBe('rt-r1');

    now += 56 * 60_000;
    expect(await auth.getAccessToken()).toBe('at-r2');
    expect(as.tokenRequests[2]?.get('refresh_token')).toBe('rt-r1'); // rotated token used
    stored = JSON.parse(secrets.map.get(SECRET_KEYS.chatgptTokens) as string) as ChatGptTokenRecord;
    expect(stored.refresh_token).toBe('rt-r2');
  });

  it('clears tokens and asks to sign in again when the refresh token is reused/invalid', async () => {
    let now = Date.now();
    const { as, auth, secrets } = await setup(() => now);
    await auth.signIn();
    as.refreshError = { status: 400, body: { error: 'refresh_token_reused' } };
    now += 2 * 3600_000;
    const err = (await auth.getAccessToken().catch((e: unknown) => e)) as ProviderError;
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.code).toBe('needs-login');
    expect(secrets.map.has(SECRET_KEYS.chatgptTokens)).toBe(false);
    expect(secrets.map.has(SECRET_KEYS.chatgptClient)).toBe(true); // registration is kept
  });

  it('signs out by revoking the refresh token and deleting the tokens', async () => {
    const { as, auth, secrets } = await setup();
    await auth.signIn();
    await auth.signOut();
    expect(as.revoked[0]?.get('token')).toBe('rt-1');
    expect(as.revoked[0]?.get('token_type_hint')).toBe('refresh_token');
    expect(as.revoked[0]?.get('client_id')).toBe('oaiapp_test123');
    expect(secrets.map.has(SECRET_KEYS.chatgptTokens)).toBe(false);
    expect(await auth.isSignedIn()).toBe(false);
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'needs-login' });
  });

  it('honours an abort signal while waiting for the browser', async () => {
    const { auth, setOpener } = await setup();
    setOpener(async () => {});
    const ac = new AbortController();
    const p = auth.signIn(ac.signal);
    setTimeout(() => ac.abort(), 50);
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
  });
});
