/**
 * Minimal OAuth 2.1 authorization server for the Vercel relay (the Cloudflare relay uses
 * workers-oauth-provider instead). Supports exactly what MCP clients such as ChatGPT need:
 *  - RFC 8414 / RFC 9728 metadata, RFC 7591 dynamic client registration (public clients),
 *  - authorization code + PKCE S256 (required), refresh tokens with rotation,
 *  - the consent step is the Jarvis pairing code; the grant is bound to that pairId and to the
 *    registration's `generation`, re-checked on every request, so unpairing revokes every token.
 * Tokens and codes are stored only as sha256 hashes.
 */

import { loadPair } from './pairs.js';
import { escapeHtml, page } from './shared/html.js';
import { normalizePairingCode, sha256Hex } from './shared/pairing.js';
import type { Store } from './store.js';

export const SCOPE = 'jarvis';
const ACCESS_TTL = 3600;
const REFRESH_TTL = 30 * 24 * 3600;
const CODE_TTL = 600;
const CLIENT_TTL = 90 * 24 * 3600;
const MAX_CODE_FAILURES = 30; // per 10 minutes, relay-wide

interface Client {
  clientId: string;
  clientName: string;
  redirectUris: string[];
}
interface CodeGrant {
  clientId: string;
  redirectUri: string;
  challenge: string;
  pairId: string;
  generation: string;
}
export interface TokenGrant {
  clientId: string;
  pairId: string;
  generation: string;
}

/** A grant is valid only while its pair exists with the same registration generation. */
async function grantIsCurrent(store: Store, grant: TokenGrant): Promise<boolean> {
  const pair = await loadPair(store, grant.pairId);
  return !!pair && !!grant.generation && pair.generation === grant.generation;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
const oauthError = (error: string, description: string, status = 400) =>
  json({ error, error_description: description }, status);

const randomToken = (bytes = 32) =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

async function s256(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...digest))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function validRedirectUri(uri: string): boolean {
  try {
    const url = new URL(uri);
    if (url.hash || url.username || url.password) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function metadata(origin: string) {
  return {
    authorizationServer: {
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [SCOPE],
      authorization_response_iss_parameter_supported: true,
    },
    protectedResource: {
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ['header'],
      resource_name: 'Jarvis',
    },
  };
}

export async function registerClient(request: Request, store: Store): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return oauthError('invalid_client_metadata', 'Body must be JSON');
  }
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u) => typeof u === 'string') : [];
  if (redirectUris.length === 0 || redirectUris.length > 10 || !redirectUris.every(validRedirectUri)) {
    return oauthError('invalid_redirect_uri', 'redirect_uris must be https (or http on loopback) URLs');
  }
  const client: Client = {
    clientId: randomToken(16),
    clientName: String(body.client_name ?? 'MCP client').slice(0, 100),
    redirectUris,
  };
  await store.set(`oauth:client:${client.clientId}`, JSON.stringify(client), { ex: CLIENT_TTL });
  return json(
    {
      client_id: client.clientId,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_id_issued_at: Math.floor(Date.now() / 1000),
    },
    201,
  );
}

async function loadClient(store: Store, clientId: string): Promise<Client | null> {
  const raw = clientId ? await store.get(`oauth:client:${clientId}`) : null;
  return raw ? (JSON.parse(raw) as Client) : null;
}

interface AuthParams {
  client: Client;
  redirectUri: string;
  state: string;
  challenge: string;
}

/** Validates an authorization request (from the query on GET, from the hidden form fields on POST). */
async function validateAuthParams(
  params: URLSearchParams,
  store: Store,
  origin: string,
): Promise<AuthParams | Response> {
  const client = await loadClient(store, params.get('client_id') ?? '');
  const redirectUri = params.get('redirect_uri') ?? '';
  if (!client?.redirectUris.includes(redirectUri)) {
    return page('Cannot connect', '<h1>Cannot connect</h1><p>Unknown app or redirect address.</p>', 400);
  }
  const state = params.get('state') ?? '';
  const fail = (error: string) => {
    const url = new URL(redirectUri);
    url.searchParams.set('error', error);
    if (state) url.searchParams.set('state', state);
    url.searchParams.set('iss', origin);
    return Response.redirect(url.toString(), 302);
  };
  if (params.get('response_type') !== 'code') return fail('unsupported_response_type');
  const challenge = params.get('code_challenge') ?? '';
  if (params.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
    return fail('invalid_request');
  }
  const resource = params.get('resource');
  if (resource && resource !== `${origin}/mcp`) return fail('invalid_target');
  return { client, redirectUri, state, challenge };
}

const FORWARDED = [
  'client_id',
  'redirect_uri',
  'response_type',
  'state',
  'code_challenge',
  'code_challenge_method',
  'resource',
];

function authorizeForm(auth: AuthParams, params: URLSearchParams, error?: string): string {
  const name = escapeHtml(auth.client.clientName);
  const hidden = FORWARDED.filter((key) => params.has(key))
    .map((key) => `<input type="hidden" name="${key}" value="${escapeHtml(params.get(key) ?? '')}">`)
    .join('\n  ');
  return `<h1>Connect ${name} to Jarvis</h1>
<p>${name} wants to use Jarvis on your computer. Access will be sent to <strong>${escapeHtml(new URL(auth.redirectUri).host)}</strong>.</p>
<p class="muted">Open Jarvis → Settings → ChatGPT relay to see your pairing code. Every call is shown in Jarvis, and risky actions still need your approval there.</p>
<form method="post" action="/authorize">
  ${hidden}
  <label for="code">Pairing code</label>
  <input id="code" name="code" type="text" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false"
    maxlength="12" required aria-describedby="code-help${error ? ' code-error' : ''}"${error ? ' aria-invalid="true" autofocus' : ''}>
  <p id="code-help" class="muted">8 characters, letters A–Z and digits 2–7.</p>
  ${error ? `<p id="code-error" class="error" role="alert">${escapeHtml(error)}</p>` : ''}
  <div class="actions">
    <button class="primary" type="submit" name="decision" value="approve">Connect</button>
    <button class="secondary" type="submit" name="decision" value="deny" formnovalidate>Cancel</button>
  </div>
</form>`;
}

export async function authorize(request: Request, store: Store, origin: string): Promise<Response> {
  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    const auth = await validateAuthParams(params, store, origin);
    if (auth instanceof Response) return auth;
    return page('Connect to Jarvis', authorizeForm(auth, params));
  }
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const form = new URLSearchParams(await request.text());
  const auth = await validateAuthParams(form, store, origin);
  if (auth instanceof Response) return auth;
  const back = new URL(auth.redirectUri);
  if (auth.state) back.searchParams.set('state', auth.state);
  back.searchParams.set('iss', origin);

  if (form.get('decision') !== 'approve') {
    back.searchParams.set('error', 'access_denied');
    return Response.redirect(back.toString(), 302);
  }

  const bucket = `oauth:fail:${Math.floor(Date.now() / 600_000)}`;
  if (Number((await store.get(bucket)) ?? 0) >= MAX_CODE_FAILURES) {
    return page('Cannot connect', '<h1>Too many attempts</h1><p>Wait 10 minutes and try again.</p>', 429);
  }
  const code = normalizePairingCode(form.get('code') ?? '');
  const pairId = code ? await store.get(`paircode:${code}`) : null;
  const pair = pairId ? await loadPair(store, pairId) : null;
  if (!pairId || !pair) {
    await store.incr(bucket, 700);
    return page(
      'Connect to Jarvis',
      authorizeForm(
        auth,
        form,
        "That pairing code doesn't match any paired computer. Check the code in Jarvis and try again.",
      ),
      400,
    );
  }

  const authCode = randomToken();
  const grant: CodeGrant = {
    clientId: auth.client.clientId,
    redirectUri: auth.redirectUri,
    challenge: auth.challenge,
    pairId,
    generation: pair.generation,
  };
  await store.set(`oauth:code:${await sha256Hex(authCode)}`, JSON.stringify(grant), { ex: CODE_TTL });
  back.searchParams.set('code', authCode);
  return Response.redirect(back.toString(), 302);
}

async function issueTokens(store: Store, grant: TokenGrant): Promise<Response> {
  const accessToken = randomToken();
  const refreshToken = randomToken();
  await store.set(`oauth:access:${await sha256Hex(accessToken)}`, JSON.stringify(grant), { ex: ACCESS_TTL });
  await store.set(`oauth:refresh:${await sha256Hex(refreshToken)}`, JSON.stringify(grant), { ex: REFRESH_TTL });
  return json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL,
    refresh_token: refreshToken,
    scope: SCOPE,
  });
}

export async function token(request: Request, store: Store): Promise<Response> {
  if (request.method !== 'POST') return oauthError('invalid_request', 'Use POST', 405);
  const form = new URLSearchParams(await request.text());
  const clientId = form.get('client_id') ?? '';
  if (!(await loadClient(store, clientId))) return oauthError('invalid_client', 'Unknown client', 401);

  switch (form.get('grant_type')) {
    case 'authorization_code': {
      const raw = await store.getdel(`oauth:code:${await sha256Hex(form.get('code') ?? '')}`);
      if (!raw) return oauthError('invalid_grant', 'Unknown or used code');
      const grant = JSON.parse(raw) as CodeGrant;
      if (grant.clientId !== clientId || grant.redirectUri !== form.get('redirect_uri')) {
        return oauthError('invalid_grant', 'Client or redirect_uri mismatch');
      }
      if ((await s256(form.get('code_verifier') ?? '')) !== grant.challenge) {
        return oauthError('invalid_grant', 'PKCE verification failed');
      }
      const tokenGrant: TokenGrant = { clientId, pairId: grant.pairId, generation: grant.generation };
      if (!(await grantIsCurrent(store, tokenGrant))) return oauthError('invalid_grant', 'This computer was unpaired');
      return issueTokens(store, tokenGrant);
    }
    case 'refresh_token': {
      const raw = await store.getdel(`oauth:refresh:${await sha256Hex(form.get('refresh_token') ?? '')}`);
      if (!raw) return oauthError('invalid_grant', 'Unknown refresh token');
      const grant = JSON.parse(raw) as TokenGrant;
      if (grant.clientId !== clientId) return oauthError('invalid_grant', 'Client mismatch');
      if (!(await grantIsCurrent(store, grant))) return oauthError('invalid_grant', 'This computer was unpaired');
      return issueTokens(store, grant);
    }
    default:
      return oauthError('unsupported_grant_type', 'Use authorization_code or refresh_token');
  }
}

/** Resolves an access token to its grant, or null (unknown, expired, or its pair was unpaired). */
export async function authenticate(request: Request, store: Store): Promise<TokenGrant | null> {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('Authorization') ?? '');
  if (!match?.[1]) return null;
  const raw = await store.get(`oauth:access:${await sha256Hex(match[1])}`);
  if (!raw) return null;
  const grant = JSON.parse(raw) as TokenGrant;
  return (await grantIsCurrent(store, grant)) ? grant : null;
}
