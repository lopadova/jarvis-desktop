import { ProviderError } from '@jarvis/core';

export type ErrorCode = ProviderError['code'];

/**
 * One logical operation (request + streamed body) bounded by a timeout and the caller's signal.
 * Use `op.signal` for fetch and body reads, then `op.fail(err)` to map aborts/timeouts to ProviderError.
 */
export interface Operation {
  readonly signal: AbortSignal;
  done(): void;
  fail(err: unknown): ProviderError;
}

export function operation(provider: string, timeoutMs: number, signal?: AbortSignal): Operation {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new Error('timeout')), timeoutMs);
  timer.unref?.();
  const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  return {
    signal: combined,
    done: () => clearTimeout(timer),
    fail(err: unknown): ProviderError {
      clearTimeout(timer);
      if (err instanceof ProviderError) return err;
      if (signal?.aborted) return new ProviderError('Request cancelled', 'aborted', provider);
      if (timeout.signal.aborted) return new ProviderError(`Timed out after ${timeoutMs} ms`, 'network', provider);
      return new ProviderError(errMessage(err), 'network', provider);
    },
  };
}

export const errMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const isAbort = (err: unknown): boolean =>
  err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');

/**
 * fetch with exactly one retry on network-level failures (connection refused/reset, DNS).
 * HTTP error statuses are returned to the caller untouched; aborts are never retried.
 */
export async function fetchRetry(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  provider: string,
  retries = 1,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchImpl(url, init);
    } catch (err) {
      if (isAbort(err) || init.signal?.aborted || attempt >= retries) {
        if (init.signal?.aborted || isAbort(err)) throw err;
        throw new ProviderError(`Network error: ${errMessage(err)}`, 'network', provider);
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

export interface ErrorBody {
  status: number;
  code?: string;
  type?: string;
  message: string;
  retryAfterMs?: number;
}

/** Reads an error response body (OpenAI/Anthropic/ElevenLabs/Fish shapes) without throwing. */
export async function readErrorBody(res: Response): Promise<ErrorBody> {
  const raw = await res.text().catch(() => '');
  const out: ErrorBody = { status: res.status, message: `HTTP ${res.status}` };
  const ra = res.headers.get('retry-after');
  if (ra) {
    const secs = Number(ra);
    out.retryAfterMs = Number.isFinite(secs) ? secs * 1000 : Math.max(0, Date.parse(ra) - Date.now()) || undefined;
  }
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const e = (typeof j.error === 'object' && j.error !== null ? j.error : j) as Record<string, unknown>;
    const detail =
      typeof j.detail === 'object' && j.detail !== null ? (j.detail as Record<string, unknown>) : undefined;
    const pick = (...vals: unknown[]): string | undefined =>
      vals.find((v) => typeof v === 'string') as string | undefined;
    out.code = pick(e.code, detail?.status, typeof j.error === 'string' ? j.error : undefined);
    out.type = pick(e.type);
    out.message = pick(e.message, detail?.message, j.error_description, j.message, j.detail) ?? out.message;
  } catch {
    if (raw) out.message = raw.slice(0, 300);
  }
  return out;
}

/** Default status → ProviderError mapping for API-key providers. */
export function httpError(
  provider: string,
  body: ErrorBody,
  overrides?: Partial<Record<number, ErrorCode>>,
): ProviderError {
  const code: ErrorCode =
    overrides?.[body.status] ??
    (body.status === 401 || body.status === 403
      ? 'not-configured'
      : body.status === 402
        ? 'cap-reached' // Payment Required: the account is out of credit
        : body.status === 429 || body.status === 529
          ? 'rate-limited'
          : body.status >= 500
            ? 'network'
            : 'bad-response');
  return new ProviderError(`${provider}: ${body.message}`, code, provider, body.retryAfterMs);
}

/** Converts a fetch Response body to an async iterable of chunks (honouring abort). */
export async function* bodyChunks(res: Response): AsyncIterable<Uint8Array> {
  if (!res.body) return;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value && value.byteLength > 0) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
