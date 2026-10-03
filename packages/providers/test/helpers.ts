import { defaultSettings, type SecretStore, type Settings, silentLogger } from '@jarvis/core';
import type { ProviderDeps } from '../src/deps.js';

export class MemorySecrets implements SecretStore {
  readonly map = new Map<string, string>();
  readonly reads: string[] = [];
  async get(key: string) {
    this.reads.push(key);
    return this.map.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.map.set(key, value);
  }
  async delete(key: string) {
    this.map.delete(key);
  }
}

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | FormData | undefined;
}

export type Handler = (call: RecordedCall) => Response | Promise<Response>;

/** fetch mock: routes by substring match on "<METHOD> <url>"; records every call. */
export function mockFetch(routes: Array<[match: string | RegExp, handler: Handler]>) {
  const calls: RecordedCall[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const body = init?.body;
    const call: RecordedCall = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body:
        typeof body === 'string' || body instanceof FormData
          ? body
          : body instanceof URLSearchParams
            ? body.toString()
            : undefined,
    };
    calls.push(call);
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const key = `${call.method} ${url}`;
    for (const [m, h] of routes) if (typeof m === 'string' ? key.includes(m) : m.test(key)) return h(call);
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fetch: fn, calls };
}

export function sse(
  events: Array<Record<string, unknown> | string>,
  opts: { named?: boolean; split?: number } = {},
): Response {
  const text = events
    .map((e) => {
      if (typeof e === 'string') return `data: ${e}\n\n`;
      const prefix = opts.named && typeof e.type === 'string' ? `event: ${e.type}\n` : '';
      return `${prefix}data: ${JSON.stringify(e)}\n\n`;
    })
    .join('');
  const bytes = new TextEncoder().encode(text);
  const step = opts.split ?? 7; // deliberately split across chunk boundaries
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += step) c.enqueue(bytes.slice(i, i + step));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export function makeDeps(over: Partial<ProviderDeps> & { settings?: () => Settings; patch?: Partial<Settings> } = {}) {
  const secrets = (over.secrets as MemorySecrets | undefined) ?? new MemorySecrets();
  const settings = { ...defaultSettings(), ...(over.patch ?? {}) };
  const deps: ProviderDeps = {
    secrets,
    settings: over.settings ?? (() => settings),
    logger: over.logger ?? silentLogger,
    openUrl: over.openUrl ?? (async () => {}),
    dataDir: over.dataDir ?? '/nonexistent-jarvis-data',
  };
  if (over.fetch) deps.fetch = over.fetch;
  return { deps, secrets: secrets as MemorySecrets, settings };
}

export async function collect(chunks: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const c of chunks) parts.push(c);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
