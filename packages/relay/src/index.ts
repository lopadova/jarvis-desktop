/**
 * Jarvis relay — Cloudflare Worker (free tier). See docs/architecture/relay-protocol.md.
 *
 *   POST   /pair/register        desktop registers { pairId, secretHash, label }
 *   DELETE /pair/register        desktop unpairs (Bearer <secret>, ?pairId=)
 *   GET    /desktop/connect      desktop WebSocket (Bearer <secret>, ?pairId=) → DesktopLink DO
 *   POST   /mcp                  MCP Streamable HTTP for ChatGPT (OAuth bearer, grant bound to pairId)
 *   GET    /authorize            OAuth consent: asks for the pairing code
 *   /oauth/token, /oauth/register, /.well-known/*   served by workers-oauth-provider
 */
import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { handleAuthorize, SCOPE } from './authorize.js';
import { type Env, type GrantProps, linkStub, registryStub } from './env.js';
import { escapeHtml, page, withSecurityHeaders } from './shared/html.js';
import { handleMcpRequest, RELAY_VERSION } from './shared/mcp.js';
import { bearerToken, PAIR_ID_RE, parseRegistration, secretMatches } from './shared/pairing.js';

export { DesktopLink } from './desktop-link.js';
export { PairRegistry } from './registry.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

/** Verifies `Authorization: Bearer <secret>` for `?pairId=`; same 401 for unknown pair and wrong secret. */
async function authenticateDesktop(request: Request, env: Env): Promise<string | Response> {
  const pairId = new URL(request.url).searchParams.get('pairId') ?? '';
  const secret = bearerToken(request.headers.get('Authorization'));
  if (!PAIR_ID_RE.test(pairId) || !secret) return json({ error: 'unauthorized' }, 401);
  const record = await registryStub(env).get(pairId);
  if (!record || !(await secretMatches(secret, record.secretHash))) return json({ error: 'unauthorized' }, 401);
  return pairId;
}

async function registerPair(request: Request, env: Env): Promise<Response> {
  if (Number(request.headers.get('content-length') ?? 0) > 4096) return json({ error: 'body too large' }, 413);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }
  const registration = parseRegistration(body);
  if (typeof registration === 'string') return json({ error: registration }, 400);
  const outcome = await registryStub(env).register(registration);
  if (!('generation' in outcome)) {
    return outcome.status === 'throttled'
      ? json({ error: 'too many registrations, try later' }, 429)
      : json({ error: 'pairId already registered' }, 409);
  }
  await linkStub(env, registration.pairId).activate(outcome.generation);
  return json({ pairId: registration.pairId }, 201);
}

/** Revokes every OAuth grant issued for this pair (grants use the pairId as their userId). */
async function revokeGrants(env: Env, pairId: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const listing = await env.OAUTH_PROVIDER.listUserGrants(pairId, { limit: 1000, cursor });
    for (const grant of listing.items) await env.OAUTH_PROVIDER.revokeGrant(grant.id, pairId);
    cursor = listing.cursor;
  } while (cursor);
}

/** Unpair: revoke the OAuth grants first, then remove the pair (tombstoned) and reset its Durable Object. */
async function unregisterPair(request: Request, env: Env): Promise<Response> {
  const pairId = await authenticateDesktop(request, env);
  if (pairId instanceof Response) return pairId;
  await revokeGrants(env, pairId);
  await registryStub(env).remove(pairId);
  await linkStub(env, pairId).deactivate();
  return new Response(null, { status: 204 });
}

async function connectDesktop(request: Request, env: Env): Promise<Response> {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return json({ error: 'expected a WebSocket upgrade' }, 426);
  }
  const pairId = await authenticateDesktop(request, env);
  if (pairId instanceof Response) return pairId;
  return linkStub(env, pairId).fetch(request);
}

function connectPage(origin: string, pairId: string | null): Response {
  const mcpUrl = `${origin}/mcp`;
  return page(
    'Jarvis relay',
    `<h1>Use Jarvis in ChatGPT</h1>
<ol>
<li>In ChatGPT open <strong>Settings → Apps &amp; Connectors → Advanced settings</strong> and turn on <strong>Developer mode</strong>.</li>
<li>Create a connector with the URL <code>${escapeHtml(mcpUrl)}</code> and authentication <strong>OAuth</strong>.</li>
<li>When asked, type the pairing code shown in Jarvis.</li>
</ol>
${pairId && PAIR_ID_RE.test(pairId) ? `<p class="muted">Pair <code>${escapeHtml(pairId)}</code></p>` : ''}`,
  );
}

/** Unprotected routes (everything that is not /mcp or an OAuth endpoint). */
const defaultHandler: ExportedHandler<Env> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    switch (url.pathname) {
      case '/':
        return page(
          'Jarvis relay',
          '<h1>Jarvis relay</h1><p>This relay connects ChatGPT to Jarvis on your computer. It is running.</p>',
        );
      case '/connect':
        return connectPage(env.PUBLIC_URL ?? url.origin, url.searchParams.get('pair'));
      case '/health':
        return json({ ok: true, version: RELAY_VERSION });
      case '/authorize':
        return handleAuthorize(request, env);
      case '/pair/register':
        if (request.method === 'POST') return registerPair(request, env);
        if (request.method === 'DELETE') return unregisterPair(request, env);
        return json({ error: 'method not allowed' }, 405);
      case '/desktop/connect':
        return connectDesktop(request, env);
      default:
        return json({ error: 'not found' }, 404);
    }
  },
};

/** /mcp — reached only with a valid OAuth access token; ctx.props carries the bound pairId. */
const mcpHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pairId, generation } = (ctx as ExecutionContext & { props: GrantProps }).props;
    const link = linkStub(env, pairId);
    // Defence in depth: a grant issued for an earlier registration of this pairId is never routed.
    if (!generation || !(await link.acceptsGeneration(generation))) {
      const description = 'This connection was unpaired from Jarvis';
      return new Response(JSON.stringify({ error: 'invalid_token', error_description: description }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': `Bearer error="invalid_token", error_description="${description}"`,
        },
      });
    }
    return handleMcpRequest(request, {
      exposedTools: () => link.exposedTools(),
      callTool: (name, args, client) => link.callTool(name, args, client),
    });
  },
};

// The OAuth resource is the relay's own /mcp URL. It is only known at runtime (Deploy-to-Cloudflare
// gives every user a different workers.dev hostname), so one provider is built per origin.
const providers = new Map<string, OAuthProvider<Env>>();
function providerFor(origin: string): OAuthProvider<Env> {
  let provider = providers.get(origin);
  if (!provider) {
    provider = new OAuthProvider<Env>({
      apiRoute: '/mcp',
      apiHandler: mcpHandler,
      defaultHandler,
      authorizeEndpoint: '/authorize',
      tokenEndpoint: '/oauth/token',
      clientRegistrationEndpoint: '/oauth/register',
      scopesSupported: [SCOPE],
      requiredScopes: [SCOPE],
      resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin] },
      accessTokenTTL: 3600,
    });
    providers.set(origin, provider);
  }
  return provider;
}

export default {
  async fetch(request, env, ctx) {
    const origin = (env.PUBLIC_URL ?? new URL(request.url).origin).replace(/\/+$/, '');
    return withSecurityHeaders(await providerFor(origin).fetch(request, env, ctx));
  },
} satisfies ExportedHandler<Env>;
