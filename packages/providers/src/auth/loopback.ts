import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { safeEqual } from './pkce.js';

export const CALLBACK_PATH = '/auth/callback';
/** Preferred port first; only the port may vary between sign-ins (scheme, host and path stay fixed). */
export const DEFAULT_LOOPBACK_PORTS = [1455, 1456, 1457, 1458, 1459, 0];

export interface CallbackResult {
  code: string;
  /** Issued `oaiapp_…` client id (present on first registration). */
  clientId?: string;
}

export interface LoopbackServer {
  readonly port: number;
  readonly redirectUri: string;
  /** Resolves on a valid callback; rejects on state mismatch, OAuth error, abort or timeout. */
  waitForCallback(expectedState: string, signal?: AbortSignal, timeoutMs?: number): Promise<CallbackResult>;
  close(): Promise<void>;
}

const page = (title: string, body: string, ok: boolean): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Jarvis Desktop — ${title}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; background: #0f1115; color: #e8eaf0; }
  @media (prefers-color-scheme: light) { body { background: #f5f6f8; color: #14161a; } }
  main { max-width: 26rem; padding: 2rem; text-align: center; }
  .mark { width: 3rem; height: 3rem; border-radius: 50%; margin: 0 auto 1rem; display: grid; place-items: center; font-size: 1.5rem; background: ${ok ? '#1f9d6a' : '#c0392b'}; color: #fff; }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
  p { margin: 0; opacity: .8; }
</style></head>
<body><main><div class="mark" aria-hidden="true">${ok ? '&#10003;' : '!'}</div><h1>${title}</h1><p>${body}</p></main></body></html>`;

const SUCCESS_PAGE = page(
  'You are signed in',
  'Jarvis Desktop is now connected to ChatGPT. You can close this tab.',
  true,
);
const errorPage = (msg: string): string =>
  page('Sign-in did not complete', `${msg} You can close this tab and try again from Jarvis Desktop.`, false);

function listen(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

/** Starts the loopback callback server on the first free port of `ports`. */
export async function startLoopback(ports: readonly number[] = DEFAULT_LOOPBACK_PORTS): Promise<LoopbackServer> {
  let server: Server | undefined;
  let lastErr: unknown;
  for (const p of ports) {
    try {
      server = await listen(p);
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!server) throw new Error(`No free loopback port for the sign-in callback (${String(lastErr)})`);
  const srv = server;
  const port = (srv.address() as AddressInfo).port;
  const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;

  let settle: ((r: { ok: true; value: CallbackResult } | { ok: false; error: Error }) => void) | undefined;
  let expected = '';

  srv.on('request', (req, res) => {
    const url = new URL(req.url ?? '/', redirectUri);
    if (req.method !== 'GET' || url.pathname !== CALLBACK_PATH) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    const q = url.searchParams;
    const send = (status: number, html: string) =>
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(html);
    if (!settle) {
      send(410, errorPage('This sign-in link has already been used.'));
      return;
    }
    if (!safeEqual(q.get('state'), expected)) {
      send(400, errorPage('The sign-in response did not match this request.'));
      settle({ ok: false, error: new Error('OAuth state mismatch') });
      return;
    }
    const oauthError = q.get('error');
    if (oauthError) {
      send(400, errorPage('ChatGPT did not authorize the request.'));
      settle({ ok: false, error: new Error(`Authorization failed: ${q.get('error_description') ?? oauthError}`) });
      return;
    }
    const code = q.get('code');
    if (!code) {
      send(400, errorPage('The sign-in response was incomplete.'));
      settle({ ok: false, error: new Error('Authorization code missing from callback') });
      return;
    }
    send(200, SUCCESS_PAGE);
    const clientId = q.get('client_id') ?? undefined;
    settle({ ok: true, value: clientId ? { code, clientId } : { code } });
  });

  return {
    port,
    redirectUri,
    waitForCallback(expectedState, signal, timeoutMs = 5 * 60_000) {
      expected = expectedState;
      return new Promise<CallbackResult>((resolve, reject) => {
        const timer = setTimeout(() => finish({ ok: false, error: new Error('Sign-in timed out') }), timeoutMs);
        timer.unref?.();
        const onAbort = () => finish({ ok: false, error: new Error('Sign-in cancelled') });
        const finish = (r: { ok: true; value: CallbackResult } | { ok: false; error: Error }) => {
          if (!settle) return;
          settle = undefined;
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          if (r.ok) resolve(r.value);
          else reject(r.error);
        };
        settle = finish;
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
      });
    },
    close: () =>
      new Promise<void>((resolve) => {
        srv.closeAllConnections?.();
        srv.close(() => resolve());
      }),
  };
}
