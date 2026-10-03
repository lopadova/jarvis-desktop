/**
 * Jarvis relay on Vercel Functions: the same HTTP surface as the Cloudflare Worker, but Functions
 * can't hold WebSockets, so the desktop long-polls (docs/architecture/relay-protocol.md §5).
 *
 *   POST   /pair/register    { pairId, secretHash, label }            → 201 | 409
 *   DELETE /pair/register    ?pairId= + Bearer <secret>               → 204 (unpair, tombstoned)
 *   GET    /desktop/poll     ?pairId= + Bearer <secret>  waits ≤ 25 s → 200 call message | 204
 *   POST   /desktop/result   ?pairId= + Bearer <secret>  body: hello | result | ping message
 *   POST   /mcp              MCP Streamable HTTP (OAuth bearer)
 *   OAuth: /.well-known/*, /oauth/register, /authorize, /oauth/token
 *
 * Queue keys (Upstash Redis): queue:<pairId> (list of call JSON), pending:<callId> → pairId,
 * result:<callId>, hello:<pairId>, seen:<pairId> (desktop polled recently). TTLs bound everything;
 * arguments and results live only for the duration of a call.
 */
import { authenticate, authorize, metadata, registerClient, SCOPE, token } from './oauth.js';
import { loadPair, registerPair, removePair } from './pairs.js';
import { escapeHtml, page, withSecurityHeaders } from './shared/html.js';
import { handleMcpRequest, OFFLINE_TEXT, RELAY_VERSION, type ToolResult, textResult } from './shared/mcp.js';
import {
  bearerToken,
  byteLength,
  type HelloMessage,
  LIMITS,
  PAIR_ID_RE,
  parseDesktopMessage,
  parseRegistration,
  secretMatches,
} from './shared/pairing.js';
import type { Store } from './store.js';

export interface RelayOptions {
  store: Store;
  /** Canonical origin; default: the request origin. */
  publicUrl?: string;
  /** How long GET /desktop/poll waits for a call. Default 25 s. */
  longPollMs?: number;
  /** Redis polling interval while waiting (each check is one Redis command). Default 2 s. */
  pollIntervalMs?: number;
  callTimeoutMs?: number;
  callsPerMinute?: number;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The desktop counts as online if it polled within this window. */
const SEEN_TTL_S = 60;

export function createRelay(options: RelayOptions): (request: Request) => Promise<Response> {
  const { store } = options;
  const longPollMs = options.longPollMs ?? 25_000;
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const callTimeoutMs = options.callTimeoutMs ?? LIMITS.callTimeoutMs;
  const callsPerMinute = options.callsPerMinute ?? LIMITS.callsPerMinute;
  const ttl = Math.ceil(callTimeoutMs / 1000) + 10;

  async function authenticateDesktop(request: Request) {
    const pairId = new URL(request.url).searchParams.get('pairId') ?? '';
    const secret = bearerToken(request.headers.get('Authorization'));
    if (!PAIR_ID_RE.test(pairId) || !secret) return null;
    const record = await loadPair(store, pairId);
    if (!record || !(await secretMatches(secret, record.secretHash))) return null;
    return { pairId, record };
  }

  async function exposedTools(pairId: string): Promise<string[]> {
    const raw = await store.get(`hello:${pairId}`);
    return raw ? (JSON.parse(raw) as HelloMessage).tools.map((tool) => tool.name) : [];
  }

  async function callTool(pairId: string, tool: string, args: Record<string, unknown>, client: string) {
    const minute = Math.floor(Date.now() / 60_000);
    if ((await store.incr(`rate:${pairId}:${minute}`, 70)) > callsPerMinute) {
      return textResult(`Too many calls: at most ${callsPerMinute} per minute. Try again shortly.`, true);
    }
    if (!(await store.get(`seen:${pairId}`))) return textResult(OFFLINE_TEXT, true);
    const id = crypto.randomUUID();
    const frame = JSON.stringify({ type: 'call', id, tool, args, client });
    if (byteLength(frame) > LIMITS.maxFrameBytes) return textResult('Arguments are larger than 64 KB', true);
    await store.set(`pending:${id}`, pairId, { ex: ttl });
    await store.lpush(`queue:${pairId}`, frame, ttl);

    const deadline = Date.now() + callTimeoutMs;
    while (Date.now() < deadline) {
      await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
      const raw = await store.getdel(`result:${id}`);
      if (raw) {
        await store.del(`pending:${id}`);
        return JSON.parse(raw) as ToolResult;
      }
    }
    await store.del(`pending:${id}`);
    return textResult(`Jarvis did not answer within ${Math.round(callTimeoutMs / 1000)} s`, true);
  }

  async function poll(request: Request): Promise<Response> {
    const desktop = await authenticateDesktop(request);
    if (!desktop) return json({ error: 'unauthorized' }, 401);
    const deadline = Date.now() + longPollMs;
    do {
      await store.set(`seen:${desktop.pairId}`, '1', { ex: SEEN_TTL_S });
      const call = await store.rpop(`queue:${desktop.pairId}`);
      if (call)
        return new Response(call, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
      await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    } while (Date.now() < deadline);
    return new Response(null, { status: 204 });
  }

  async function desktopMessage(request: Request): Promise<Response> {
    const desktop = await authenticateDesktop(request);
    if (!desktop) return json({ error: 'unauthorized' }, 401);
    const raw = await request.text();
    if (byteLength(raw) > LIMITS.maxFrameBytes) return json({ error: 'message larger than 64 KB' }, 413);
    const msg = parseDesktopMessage(raw);
    if (!msg) return json({ error: 'invalid message' }, 400);
    switch (msg.type) {
      case 'hello':
        await store.set(`hello:${desktop.pairId}`, JSON.stringify(msg));
        await store.set(`seen:${desktop.pairId}`, '1', { ex: SEEN_TTL_S });
        return new Response(null, { status: 204 });
      case 'result': {
        // Only the desktop that owns the call may answer it.
        if ((await store.get(`pending:${msg.id}`)) !== desktop.pairId) return json({ error: 'unknown call' }, 404);
        const result: ToolResult = msg.ok
          ? { content: msg.content ?? [] }
          : textResult(msg.error || 'Jarvis could not run the tool', true);
        await store.set(`result:${msg.id}`, JSON.stringify(result), { ex: ttl });
        return new Response(null, { status: 204 });
      }
      case 'ping':
        return json({ type: 'pong', t: msg.t });
      default:
        return new Response(null, { status: 204 });
    }
  }

  async function route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const origin = (options.publicUrl ?? url.origin).replace(/\/+$/, '');
    switch (url.pathname) {
      case '/':
        return page(
          'Jarvis relay',
          '<h1>Jarvis relay</h1><p>This relay connects ChatGPT to Jarvis on your computer. It is running.</p>',
        );
      case '/health':
        return json({ ok: true, version: RELAY_VERSION, transport: 'long-poll' });
      case '/pair/register': {
        if (request.method === 'DELETE') {
          const desktop = await authenticateDesktop(request);
          if (!desktop) return json({ error: 'unauthorized' }, 401);
          await removePair(store, desktop.pairId, desktop.record);
          return new Response(null, { status: 204 });
        }
        if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
        const hour = Math.floor(Date.now() / 3_600_000);
        if ((await store.incr(`reg:${hour}`, 3700)) > 60) return json({ error: 'too many registrations' }, 429);
        let body: unknown;
        try {
          body = JSON.parse(await request.text());
        } catch {
          return json({ error: 'invalid JSON' }, 400);
        }
        const registration = parseRegistration(body);
        if (typeof registration === 'string') return json({ error: registration }, 400);
        const outcome = await registerPair(store, registration);
        return outcome === 'created'
          ? json({ pairId: registration.pairId }, 201)
          : json({ error: 'pairId already registered' }, 409);
      }
      case '/desktop/poll':
        return request.method === 'GET' ? poll(request) : json({ error: 'method not allowed' }, 405);
      case '/desktop/result':
        return request.method === 'POST' ? desktopMessage(request) : json({ error: 'method not allowed' }, 405);
      case '/.well-known/oauth-authorization-server':
        return json(metadata(origin).authorizationServer);
      case '/.well-known/oauth-protected-resource':
      case '/.well-known/oauth-protected-resource/mcp':
        return json(metadata(origin).protectedResource);
      case '/oauth/register':
        return request.method === 'POST' ? registerClient(request, store) : json({ error: 'method not allowed' }, 405);
      case '/oauth/token':
        return token(request, store);
      case '/authorize':
        return authorize(request, store, origin);
      case '/connect':
        return page(
          'Jarvis relay',
          `<h1>Use Jarvis in ChatGPT</h1><p>Add a connector with the URL <code>${escapeHtml(`${origin}/mcp`)}</code> and OAuth authentication, then type the pairing code shown in Jarvis.</p>`,
        );
      case '/mcp': {
        const grant = await authenticate(request, store);
        if (!grant) {
          return json({ error: 'invalid_token' }, 401, {
            'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="${SCOPE}"`,
          });
        }
        return handleMcpRequest(request, {
          exposedTools: () => exposedTools(grant.pairId),
          callTool: (name, args, client) => callTool(grant.pairId, name, args, client),
        });
      }
      default:
        return json({ error: 'not found' }, 404);
    }
  }

  return async (request) => withSecurityHeaders(await route(request));
}
