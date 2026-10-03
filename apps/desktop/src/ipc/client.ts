/**
 * JSON-RPC 2.0 client for the sidecar WebSocket (ADR 0002), role `ui`.
 *
 * - Authenticates with the WebSocket subprotocol `jarvis.<launch token>`; the endpoint is fetched
 *   again before every (re)connect because the shell may have restarted the sidecar.
 * - Reconnects with capped exponential backoff; pending calls fail fast on disconnect.
 * - Transport-agnostic: the socket factory is injectable for tests (fake WebSocket).
 */
import type { AppMethod, AppParams, RpcMessage, RpcResponse } from '@jarvis/core';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export interface Endpoint {
  port: number;
  token: string;
}

/** The subset of the DOM WebSocket the client relies on. */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export type SocketFactory = (url: string, protocols: string[]) => SocketLike;

export type NotificationHandler = (method: string, params: unknown) => void;
export type StatusHandler = (status: ConnectionStatus) => void;

/** What the UI needs from a backend (real sidecar or the in-browser mock). */
export interface Transport {
  call<M extends AppMethod>(method: M, params: AppParams<M>): Promise<unknown>;
  onNotification(handler: NotificationHandler): () => void;
  onStatus(handler: StatusHandler): () => void;
  start(): void;
  stop(): void;
}

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export interface RpcClientOptions {
  endpoint: () => Promise<Endpoint>;
  socketFactory?: SocketFactory;
  timeoutMs?: number;
  backoff?: { baseMs: number; maxMs: number };
  /** Injectable timers for tests. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const OPEN = 1;

interface Pending {
  resolve(v: unknown): void;
  reject(e: unknown): void;
  timer: unknown;
}

export function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
}

export function subprotocolFor(token: string): string {
  return `jarvis.${token}`;
}

export class RpcClient implements Transport {
  private socket: SocketLike | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly notificationHandlers = new Set<NotificationHandler>();
  private readonly statusHandlers = new Set<StatusHandler>();
  private status: ConnectionStatus = 'closed';
  private attempt = 0;
  private running = false;
  private reconnectTimer: unknown = null;
  private readonly opts: Required<Omit<RpcClientOptions, 'socketFactory'>> & { socketFactory: SocketFactory };

  constructor(opts: RpcClientOptions) {
    this.opts = {
      endpoint: opts.endpoint,
      socketFactory: opts.socketFactory ?? ((url, protocols) => new WebSocket(url, protocols) as unknown as SocketLike),
      timeoutMs: opts.timeoutMs ?? 15_000,
      backoff: opts.backoff ?? { baseMs: 500, maxMs: 10_000 },
      setTimer: opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimer: opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)),
    };
  }

  get connectionStatus(): ConnectionStatus {
    return this.status;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.connect();
  }

  stop(): void {
    this.running = false;
    if (this.reconnectTimer !== null) this.opts.clearTimer(this.reconnectTimer);
    this.reconnectTimer = null;
    const s = this.socket;
    this.socket = null;
    s?.close(1000, 'client stop');
    this.failAll(new RpcError(-32002, 'client stopped'));
    this.setStatus('closed');
  }

  onNotification(handler: NotificationHandler): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    handler(this.status);
    return () => this.statusHandlers.delete(handler);
  }

  call<M extends AppMethod>(method: M, params: AppParams<M>): Promise<unknown> {
    const s = this.socket;
    if (!s || s.readyState !== OPEN) return Promise.reject(new RpcError(-32002, 'not connected'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = this.opts.setTimer(() => {
        this.pending.delete(id);
        reject(new RpcError(-32603, `timeout: ${method}`));
      }, this.opts.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      s.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const h of this.statusHandlers) h(status);
  }

  private async connect(): Promise<void> {
    if (!this.running) return;
    this.setStatus('connecting');
    let ep: Endpoint;
    try {
      ep = await this.opts.endpoint();
    } catch {
      this.scheduleReconnect();
      return;
    }
    if (!this.running) return;
    const socket = this.opts.socketFactory(`ws://127.0.0.1:${ep.port}/?role=ui`, [subprotocolFor(ep.token)]);
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.attempt = 0;
      this.setStatus('open');
    };
    socket.onmessage = (ev) => {
      if (this.socket !== socket) return;
      if (typeof ev.data === 'string') this.handleMessage(ev.data);
    };
    socket.onerror = () => {
      /* onclose follows */
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.failAll(new RpcError(-32002, 'connection closed'));
      this.setStatus('closed');
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    const delay = backoffDelay(this.attempt++, this.opts.backoff.baseMs, this.opts.backoff.maxMs);
    this.setStatus('closed');
    this.reconnectTimer = this.opts.setTimer(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private failAll(err: Error): void {
    for (const [id, p] of this.pending) {
      this.opts.clearTimer(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
  }

  private handleMessage(raw: string): void {
    let msg: RpcMessage;
    try {
      msg = JSON.parse(raw) as RpcMessage;
    } catch {
      return;
    }
    if (typeof msg !== 'object' || msg === null) return;
    if ('method' in msg && !('id' in msg)) {
      for (const h of this.notificationHandlers) h(msg.method, msg.params);
      return;
    }
    if ('id' in msg && !('method' in msg)) {
      const res = msg as RpcResponse;
      const p = typeof res.id === 'number' ? this.pending.get(res.id) : undefined;
      if (!p) return;
      this.pending.delete(res.id as number);
      this.opts.clearTimer(p.timer);
      if (res.error) p.reject(new RpcError(res.error.code, res.error.message, res.error.data));
      else p.resolve(res.result);
    }
    // Requests from the sidecar to the ui role are not part of the contract; ignore them.
  }
}
