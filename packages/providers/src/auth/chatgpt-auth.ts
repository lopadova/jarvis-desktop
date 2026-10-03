/**
 * Sign in with ChatGPT — open-source token-sharing flow (ADR 0004).
 *
 * Authorization Code + PKCE (S256) + OIDC nonce through the system browser and a loopback redirect.
 * The first sign-in registers this host with `client_id=dynamic_agent_client`; the callback returns
 * the issued `oaiapp_…` client id, which is persisted and reused for every later sign-in and refresh.
 * Tokens live only in the SecretStore (OS keyring) and are refreshed proactively before expiry.
 */
import { randomUUID } from 'node:crypto';
import { ProviderError, SECRET_KEYS } from '@jarvis/core';
import { createLocalJWKSet, type JSONWebKeySet, type JWTPayload, jwtVerify } from 'jose';
import { fetchOf, type ProviderDeps } from '../deps.js';
import { errMessage, readErrorBody } from '../util/http.js';
import { DEFAULT_LOOPBACK_PORTS, startLoopback } from './loopback.js';
import { createPkceSession, safeEqual } from './pkce.js';

export const CHATGPT_AUTH_BASE = 'https://auth.openai.com';
export const CHATGPT_RESOURCE = 'https://api.openai.com/v1';
export const CHATGPT_SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export const DYNAMIC_CLIENT_ID = 'dynamic_agent_client';
export const AGENT_NAME = 'Jarvis Desktop';

/** Refresh this long before the access token expires. */
const REFRESH_SKEW_MS = 5 * 60_000;
const PROVIDER = 'chatgpt';

/** Refresh-token errors that mean "sign in again" (errors-and-recovery). */
const RELOGIN_ERRORS = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
]);

/** Persisted under SECRET_KEYS.chatgptClient — survives sign-out so re-authorization reuses the registration. */
export interface ChatGptClientRecord {
  ext_agent_host_id: string;
  client_id?: string;
  /** Last validated ID token, sent as `id_token_hint` on re-authorization. */
  id_token_hint?: string;
  email?: string;
}

/** Persisted under SECRET_KEYS.chatgptTokens (shape follows the token-sharing credential record). */
export interface ChatGptTokenRecord {
  email?: string;
  issuer: string;
  subject: string;
  client_id: string;
  ext_agent_host_id: string;
  id_token: string;
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  /** Absolute expiry (ms since epoch), derived from expires_in at save time. */
  expires_at: number;
  /** Earliest time a refresh is accepted (ms since epoch), when the server provides it. */
  earliest_refresh_at?: number;
  scopes: string[];
  plan?: string;
  saved_at: string;
}

export interface ChatGptAuthOptions {
  /** Override for tests (defaults to https://auth.openai.com). */
  authBase?: string;
  /** Loopback ports to try in order (0 = any free port). */
  ports?: readonly number[];
  /** Max wait for the browser callback. */
  callbackTimeoutMs?: number;
  now?: () => number;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  earliest_refresh_at?: number | string;
}

export class ChatGptPlanAuth {
  private readonly authBase: string;
  private readonly ports: readonly number[];
  private readonly callbackTimeoutMs: number;
  private readonly now: () => number;
  private jwks: JSONWebKeySet | undefined;
  private refreshing: Promise<ChatGptTokenRecord> | undefined;

  constructor(
    private readonly deps: ProviderDeps,
    options: ChatGptAuthOptions = {},
  ) {
    this.authBase = (options.authBase ?? CHATGPT_AUTH_BASE).replace(/\/$/, '');
    this.ports = options.ports ?? DEFAULT_LOOPBACK_PORTS;
    this.callbackTimeoutMs = options.callbackTimeoutMs ?? 5 * 60_000;
    this.now = options.now ?? Date.now;
  }

  get issuer(): string {
    return this.authBase;
  }

  // ───────────────────────── public API ─────────────────────────

  async signIn(signal?: AbortSignal): Promise<{ account: string; plan?: string }> {
    const client = await this.loadClient();
    const tokens = await this.readTokens();
    const pkce = createPkceSession();
    const loopback = await startLoopback(this.ports);
    try {
      const clientId = client.client_id ?? DYNAMIC_CLIENT_ID;
      const q = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: loopback.redirectUri,
        scope: CHATGPT_SCOPES,
        resource: CHATGPT_RESOURCE,
        state: pkce.state,
        nonce: pkce.nonce,
        code_challenge: pkce.challenge,
        code_challenge_method: 'S256',
      });
      if (!client.client_id) {
        q.set('agent_name_hint', AGENT_NAME);
        q.set('ext_agent_host_id', client.ext_agent_host_id);
      } else if (tokens?.id_token || client.id_token_hint) {
        q.set('id_token_hint', tokens?.id_token ?? client.id_token_hint ?? '');
      } else if (client.email) {
        q.set('login_hint', client.email);
      }
      const callback = loopback.waitForCallback(pkce.state, signal, this.callbackTimeoutMs);
      callback.catch(() => {}); // observed below; avoids an unhandled rejection if openUrl throws
      await this.deps.openUrl(`${this.authBase}/api/accounts/authorize?${q.toString()}`);
      const { code, clientId: returnedClientId } = await callback;

      const issuedClientId = returnedClientId ?? client.client_id;
      if (!issuedClientId || issuedClientId === DYNAMIC_CLIENT_ID) {
        throw new ProviderError('Sign-in callback did not include the issued client id', 'bad-response', PROVIDER);
      }
      if (client.client_id && returnedClientId && returnedClientId !== client.client_id) {
        this.deps.logger.warn('chatgpt: authorization server issued a different client id; using the new one');
      }

      const res = await this.tokenRequest({
        grant_type: 'authorization_code',
        client_id: issuedClientId,
        code,
        code_verifier: pkce.verifier,
        redirect_uri: loopback.redirectUri,
        resource: CHATGPT_RESOURCE,
      });
      const claims = await this.verifyIdToken(res.id_token, issuedClientId, pkce.nonce);
      const record = this.toRecord(res, claims, issuedClientId, client.ext_agent_host_id);
      await this.writeTokens(record);
      await this.writeClient({
        ext_agent_host_id: client.ext_agent_host_id,
        client_id: issuedClientId,
        id_token_hint: record.id_token,
        email: record.email,
      });
      this.deps.logger.info('chatgpt: signed in', { plan: record.plan ?? 'unknown' });
      return record.plan
        ? { account: record.email ?? record.subject, plan: record.plan }
        : { account: record.email ?? record.subject };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(
        `Sign in with ChatGPT failed: ${errMessage(err)}`,
        signal?.aborted ? 'aborted' : 'needs-login',
        PROVIDER,
      );
    } finally {
      await loopback.close();
    }
  }

  /** Revokes the refresh token (best effort) and forgets the tokens; the client registration is kept. */
  async signOut(): Promise<void> {
    const tokens = await this.readTokens();
    if (tokens) {
      try {
        const endpoint = await this.revocationEndpoint();
        const res = await fetchOf(this.deps)(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            token: tokens.refresh_token,
            token_type_hint: 'refresh_token',
            client_id: tokens.client_id,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) this.deps.logger.warn('chatgpt: token revocation failed', { status: res.status });
      } catch (err) {
        this.deps.logger.warn('chatgpt: token revocation failed', { error: errMessage(err) });
      }
    }
    await this.deps.secrets.delete(SECRET_KEYS.chatgptTokens);
  }

  async isSignedIn(): Promise<boolean> {
    const t = await this.readTokens();
    return !!t?.refresh_token || (!!t?.access_token && t.expires_at > this.now());
  }

  /** Account details of the signed-in user, without network access. */
  async account(): Promise<{ account: string; plan?: string } | null> {
    const t = await this.readTokens();
    if (!t) return null;
    return t.plan ? { account: t.email ?? t.subject, plan: t.plan } : { account: t.email ?? t.subject };
  }

  /** Returns a valid access token, refreshing proactively (and rotating the refresh token) when close to expiry. */
  async getAccessToken(): Promise<string> {
    const t = await this.readTokens();
    if (!t) throw new ProviderError('Not signed in with ChatGPT', 'needs-login', PROVIDER);
    const now = this.now();
    const expiring = t.expires_at - now <= REFRESH_SKEW_MS;
    const expired = t.expires_at <= now;
    const refreshAllowed = !t.earliest_refresh_at || now >= t.earliest_refresh_at || expired;
    if (!expiring || !refreshAllowed) return t.access_token;
    return (await this.refresh(t)).access_token;
  }

  /** Forces a refresh (e.g. after a 401 on a token we believed valid). */
  async forceRefresh(): Promise<string> {
    const t = await this.readTokens();
    if (!t) throw new ProviderError('Not signed in with ChatGPT', 'needs-login', PROVIDER);
    return (await this.refresh(t)).access_token;
  }

  // ───────────────────────── internals ─────────────────────────

  private refresh(current: ChatGptTokenRecord): Promise<ChatGptTokenRecord> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh(current).finally(() => {
        this.refreshing = undefined;
      });
    }
    return this.refreshing;
  }

  private async doRefresh(current: ChatGptTokenRecord): Promise<ChatGptTokenRecord> {
    let res: TokenResponse;
    try {
      res = await this.tokenRequest({
        grant_type: 'refresh_token',
        client_id: current.client_id,
        refresh_token: current.refresh_token,
        resource: CHATGPT_RESOURCE,
      });
    } catch (err) {
      if (err instanceof ProviderError && err.code === 'needs-login') {
        await this.deps.secrets.delete(SECRET_KEYS.chatgptTokens);
      }
      throw err;
    }
    let claims: JWTPayload | undefined;
    if (res.id_token) {
      try {
        claims = await this.verifyIdToken(res.id_token, current.client_id);
      } catch (err) {
        this.deps.logger.warn('chatgpt: refreshed ID token failed validation; keeping the previous one', {
          error: errMessage(err),
        });
        res.id_token = undefined;
      }
    }
    const next: ChatGptTokenRecord = {
      ...current,
      access_token: res.access_token ?? current.access_token,
      // Rotation: always replace the refresh token together with the access token.
      refresh_token: res.refresh_token ?? current.refresh_token,
      id_token: res.id_token ?? current.id_token,
      token_type: res.token_type ?? current.token_type,
      expires_in: res.expires_in ?? 3600,
      expires_at: this.now() + (res.expires_in ?? 3600) * 1000,
      earliest_refresh_at: toMs(res.earliest_refresh_at),
      scopes: res.scope ? res.scope.split(/\s+/).filter(Boolean).sort() : current.scopes,
      plan: (claims && planFromClaims(claims)) ?? current.plan,
      saved_at: new Date(this.now()).toISOString(),
    };
    if (!res.access_token) throw new ProviderError('Token refresh returned no access token', 'bad-response', PROVIDER);
    await this.writeTokens(next);
    this.deps.logger.debug('chatgpt: access token refreshed');
    return next;
  }

  private async tokenRequest(form: Record<string, string>): Promise<TokenResponse> {
    let res: Response;
    try {
      res = await fetchOf(this.deps)(`${this.authBase}/api/accounts/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams(form),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new ProviderError(`Token endpoint unreachable: ${errMessage(err)}`, 'network', PROVIDER);
    }
    if (!res.ok) {
      const body = await readErrorBody(res);
      const relogin = body.code !== undefined && RELOGIN_ERRORS.has(body.code);
      throw new ProviderError(
        `Token request failed (${body.code ?? body.status}): ${body.message}`,
        relogin || res.status === 401 ? 'needs-login' : res.status >= 500 ? 'network' : 'bad-response',
        PROVIDER,
      );
    }
    return (await res.json()) as TokenResponse;
  }

  private async loadJwks(force = false): Promise<JSONWebKeySet> {
    if (this.jwks && !force) return this.jwks;
    const res = await fetchOf(this.deps)(`${this.authBase}/.well-known/jwks.json`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new ProviderError(`JWKS fetch failed: HTTP ${res.status}`, 'network', PROVIDER);
    this.jwks = (await res.json()) as JSONWebKeySet;
    return this.jwks;
  }

  /** Verifies signature (JWKS), issuer, audience, expiry and — on sign-in — the nonce. */
  async verifyIdToken(idToken: string | undefined, clientId: string, nonce?: string): Promise<JWTPayload> {
    if (!idToken) throw new ProviderError('Token response has no ID token', 'bad-response', PROVIDER);
    const verify = async (jwks: JSONWebKeySet) =>
      (
        await jwtVerify(idToken, createLocalJWKSet(jwks), {
          issuer: this.authBase,
          audience: clientId,
          clockTolerance: 60,
        })
      ).payload;
    let payload: JWTPayload;
    try {
      try {
        payload = await verify(await this.loadJwks());
      } catch (err) {
        // Key rotation: refetch the JWKS once when no key matches.
        if ((err as { code?: string }).code !== 'ERR_JWKS_NO_MATCHING_KEY') throw err;
        payload = await verify(await this.loadJwks(true));
      }
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(`ID token validation failed: ${errMessage(err)}`, 'bad-response', PROVIDER);
    }
    if (nonce !== undefined && !safeEqual(typeof payload.nonce === 'string' ? payload.nonce : undefined, nonce)) {
      throw new ProviderError('ID token validation failed: nonce mismatch', 'bad-response', PROVIDER);
    }
    if (!payload.sub) throw new ProviderError('ID token has no subject', 'bad-response', PROVIDER);
    return payload;
  }

  private async revocationEndpoint(): Promise<string> {
    try {
      const res = await fetchOf(this.deps)(`${this.authBase}/.well-known/openid-configuration`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const cfg = (await res.json()) as { revocation_endpoint?: string };
        if (cfg.revocation_endpoint) return cfg.revocation_endpoint;
      }
    } catch {
      // fall back below
    }
    return `${this.authBase}/oauth/revoke`;
  }

  private toRecord(res: TokenResponse, claims: JWTPayload, clientId: string, hostId: string): ChatGptTokenRecord {
    if (!res.access_token || !res.refresh_token || !res.id_token) {
      throw new ProviderError('Token response is missing access, refresh or ID token', 'bad-response', PROVIDER);
    }
    const email = typeof claims.email === 'string' ? claims.email : undefined;
    const plan = planFromClaims(claims);
    const expiresIn = res.expires_in ?? 3600;
    return {
      ...(email ? { email } : {}),
      issuer: this.authBase,
      subject: claims.sub as string,
      client_id: clientId,
      ext_agent_host_id: hostId,
      id_token: res.id_token,
      access_token: res.access_token,
      refresh_token: res.refresh_token,
      token_type: res.token_type ?? 'Bearer',
      expires_in: expiresIn,
      expires_at: this.now() + expiresIn * 1000,
      earliest_refresh_at: toMs(res.earliest_refresh_at),
      scopes: (res.scope ?? CHATGPT_SCOPES).split(/\s+/).filter(Boolean).sort(),
      ...(plan ? { plan } : {}),
      saved_at: new Date(this.now()).toISOString(),
    };
  }

  private async loadClient(): Promise<ChatGptClientRecord> {
    const raw = await this.deps.secrets.get(SECRET_KEYS.chatgptClient);
    if (raw) {
      try {
        const rec = JSON.parse(raw) as ChatGptClientRecord;
        if (rec.ext_agent_host_id) return rec;
      } catch {
        this.deps.logger.warn('chatgpt: stored client record is corrupt; registering again');
      }
    }
    const fresh: ChatGptClientRecord = { ext_agent_host_id: `urn:uuid:${randomUUID()}` };
    await this.writeClient(fresh);
    return fresh;
  }

  private writeClient(rec: ChatGptClientRecord): Promise<void> {
    return this.deps.secrets.set(SECRET_KEYS.chatgptClient, JSON.stringify(rec));
  }

  private async readTokens(): Promise<ChatGptTokenRecord | null> {
    const raw = await this.deps.secrets.get(SECRET_KEYS.chatgptTokens);
    if (!raw) return null;
    try {
      const t = JSON.parse(raw) as ChatGptTokenRecord;
      return t.access_token ? t : null;
    } catch {
      return null;
    }
  }

  private writeTokens(rec: ChatGptTokenRecord): Promise<void> {
    return this.deps.secrets.set(SECRET_KEYS.chatgptTokens, JSON.stringify(rec));
  }
}

function toMs(v: number | string | undefined): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  const n = Number(v);
  if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
  const d = Date.parse(v);
  return Number.isNaN(d) ? undefined : d;
}

/** The plan name is not part of the documented contract; read it opportunistically if present. */
function planFromClaims(claims: JWTPayload): string | undefined {
  const auth = claims['https://api.openai.com/auth'];
  if (auth && typeof auth === 'object') {
    const p = (auth as Record<string, unknown>).chatgpt_plan_type;
    if (typeof p === 'string' && p) return p;
  }
  return typeof claims.plan === 'string' ? claims.plan : undefined;
}
