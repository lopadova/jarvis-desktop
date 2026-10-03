/**
 * The single Vercel Function behind every route. vercel.json rewrites `/(.*)` to
 * `/api/relay?__path=/$1`, so the original path is restored here before routing.
 */
import { createRelay } from '../src/app.js';
import { upstashStore } from '../src/store.js';

let relay: ((request: Request) => Promise<Response>) | undefined;

export default {
  async fetch(request: Request): Promise<Response> {
    relay ??= createRelay({
      store: upstashStore(process.env),
      publicUrl: process.env.PUBLIC_URL,
      pollIntervalMs: Number(process.env.POLL_INTERVAL_MS) || undefined,
    });
    const url = new URL(request.url);
    const path = url.searchParams.get('__path');
    if (path !== null) {
      url.pathname = path.startsWith('/') ? path : `/${path}`;
      url.searchParams.delete('__path');
    }
    return relay(new Request(url, request));
  },
};
