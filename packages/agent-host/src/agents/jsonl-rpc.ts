/**
 * Minimal bidirectional JSON-RPC peer over newline-delimited JSON (one message per line), as spoken by
 * `codex app-server` on stdio. Messages omit the `"jsonrpc": "2.0"` header (the app-server accepts and
 * emits them without it). Requests from the other side are answered by `onRequest`.
 */
import type { Readable, Writable } from 'node:stream';

export type JsonRpcId = string | number;

export interface JsonRpcMessage {
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class JsonRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'JsonRpcError';
  }
}

/** Largest single line accepted from the peer (agent messages and diffs can be big). */
export const MAX_LINE = 16 * 1024 * 1024;

export interface JsonlRpcPeerOptions {
  onNotification?: (method: string, params: unknown) => void;
  /** Answers a request from the peer; throw JsonRpcError for an error response. */
  onRequest?: (method: string, params: unknown) => Promise<unknown>;
  onProtocolError?: (detail: string) => void;
}

export class JsonlRpcPeer {
  private nextId = 1;
  private buf = '';
  private closed: Error | null = null;
  private readonly pending = new Map<JsonRpcId, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor(
    input: Readable,
    private readonly output: Writable,
    private readonly opts: JsonlRpcPeerOptions = {},
  ) {
    input.setEncoding?.('utf8');
    input.on('data', (chunk: string | Buffer) => this.onData(String(chunk)));
    input.on('end', () => this.close(new Error('the peer closed the stream')));
    input.on('error', (e: Error) => this.close(e));
    output.on('error', (e: Error) => this.close(e));
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = 60_000): Promise<T> {
    if (this.closed) return Promise.reject(this.closed);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out after ${Math.round(timeoutMs / 1000)} s`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params });
  }

  close(reason: Error = new Error('closed')): void {
    if (this.closed) return;
    this.closed = reason;
    for (const p of this.pending.values()) p.reject(reason);
    this.pending.clear();
  }

  get isClosed(): boolean {
    return this.closed !== null;
  }

  private write(msg: JsonRpcMessage): void {
    if (this.closed) return;
    try {
      this.output.write(`${JSON.stringify(msg)}\n`);
    } catch (e) {
      this.close(e as Error);
    }
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    if (this.buf.length > MAX_LINE && !this.buf.includes('\n')) {
      this.opts.onProtocolError?.('line too long');
      this.buf = '';
      return;
    }
    let nl = this.buf.indexOf('\n');
    while (nl >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (line) this.onLine(line);
      nl = this.buf.indexOf('\n');
    }
  }

  private onLine(line: string): void {
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.opts.onProtocolError?.(`not JSON: ${line.slice(0, 120)}`);
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (typeof msg.method === 'string') {
      if (msg.id === undefined || msg.id === null) {
        this.opts.onNotification?.(msg.method, msg.params);
        return;
      }
      const id = msg.id;
      const handler = this.opts.onRequest;
      if (!handler) {
        this.write({ id, error: { code: -32601, message: `method not supported: ${msg.method}` } });
        return;
      }
      handler(msg.method, msg.params).then(
        (result) => this.write({ id, result: result ?? null }),
        (e: unknown) =>
          this.write({
            id,
            error: {
              code: e instanceof JsonRpcError ? e.code : -32603,
              message: e instanceof Error ? e.message : String(e),
            },
          }),
      );
      return;
    }
    if (msg.id === undefined || msg.id === null) return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.error) p.reject(new JsonRpcError(msg.error.code, msg.error.message));
    else p.resolve(msg.result);
  }
}
