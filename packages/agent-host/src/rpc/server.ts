/**
 * Loopback JSON-RPC 2.0 server over WebSocket (ADR 0002). Works under Node and Bun (`ws` package).
 *
 * - Binds 127.0.0.1 only; authentication and Origin checks happen before the upgrade (see auth.ts).
 * - Every request's params are validated with the zod schema registered for its method → `invalidParams`.
 * - Role gating: each method lists the roles that may call it; `mcp` can only reach `mcp.call`.
 * - The server also SENDS requests to the `shell` client (`host.*`) and awaits responses with timeouts.
 * - TTS audio goes to the shell as binary frames.
 * - Once a shell has connected, losing it for longer than `shellGraceMs` fires `onShellLost`
 *   (the sidecar then exits, so no orphan sidecars survive the app).
 */
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Logger } from '@jarvis/core';
import {
  type HostMethod,
  type HostMethods,
  JSONRPC,
  type Role,
  RpcErrorCode,
  type RpcMessage,
  type RpcResponse,
  type UiEvent,
} from '@jarvis/core';
import { type WebSocket, WebSocketServer } from 'ws';
import type { z } from 'zod';
import {
  type CallContext,
  DEFAULT_HOST_TIMEOUT_MS,
  encodeAudioFrame,
  HOST_TIMEOUTS,
  type HostClient,
  type UiSink,
} from '../host.js';
import { newId } from '../util.js';
import { type AuthConfig, authenticate, parseProtocols } from './auth.js';

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

export interface MethodSpec {
  schema: z.ZodType;
  roles: readonly Role[];
  handler: (params: never, ctx: CallContext) => unknown;
}

type AuthedRequest = IncomingMessage & { jarvisRole?: Role; jarvisSession?: string | undefined };

interface Conn {
  id: string;
  role: Role;
  sessionId?: string;
  ws: WebSocket;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface RpcServerOptions extends AuthConfig {
  logger: Logger;
  port?: number;
  shellGraceMs?: number;
  onShellLost?: () => void;
  onShellConnected?: () => void;
  maxPayload?: number;
}

/** UI events also forwarded to the shell (it needs settings and the pill state). */
const SHELL_EVENTS: readonly UiEvent[] = ['ui.settings', 'ui.pill'];

export class RpcServer implements HostClient, UiSink {
  private wss: WebSocketServer | null = null;
  private readonly conns = new Map<string, Conn>();
  private readonly methods = new Map<string, MethodSpec>();
  private readonly pending = new Map<string, Pending>();
  private shell: Conn | null = null;
  private shellLostTimer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  port = 0;

  constructor(private readonly opts: RpcServerOptions) {}

  register(method: string, spec: MethodSpec): void {
    this.methods.set(method, spec);
  }

  async listen(): Promise<number> {
    const wss = new WebSocketServer({
      host: '127.0.0.1',
      port: this.opts.port ?? 0,
      maxPayload: this.opts.maxPayload ?? 1024 * 1024,
      perMessageDeflate: false,
      verifyClient: (info, cb) => {
        const res = authenticate(this.opts, {
          origin: info.req.headers.origin,
          url: info.req.url,
          protocols: parseProtocols(info.req.headers['sec-websocket-protocol']),
        });
        if (!res.ok) {
          this.opts.logger.warn('rpc connection refused', { reason: res.reason, status: res.status });
          cb(false, res.status, res.reason);
          return;
        }
        const tagged = info.req as AuthedRequest;
        tagged.jarvisRole = res.role;
        tagged.jarvisSession = res.sessionId;
        cb(true);
      },
      handleProtocols: (protocols) => {
        for (const p of protocols) if (p.startsWith('jarvis.')) return p;
        return false;
      },
    });
    this.wss = wss;
    wss.on('connection', (ws, req) => {
      const tagged = req as AuthedRequest;
      this.onConnection(ws, tagged.jarvisRole ?? 'ui', tagged.jarvisSession);
    });
    await new Promise<void>((resolve, reject) => {
      wss.once('listening', resolve);
      wss.once('error', reject);
    });
    this.port = (wss.address() as AddressInfo).port;
    return this.port;
  }

  async close(): Promise<void> {
    if (this.shellLostTimer) clearTimeout(this.shellLostTimer);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('server closing'));
    }
    this.pending.clear();
    for (const c of this.conns.values()) c.ws.terminate();
    this.conns.clear();
    await new Promise<void>((r) => (this.wss ? this.wss.close(() => r()) : r()));
    this.wss = null;
  }

  // ───────── connections ─────────

  private onConnection(ws: WebSocket, role: Role, sessionId?: string): void {
    const conn: Conn = sessionId ? { id: newId('c_'), role, ws, sessionId } : { id: newId('c_'), role, ws };
    this.conns.set(conn.id, conn);
    if (role === 'shell') {
      if (this.shell && this.shell.ws !== ws) this.shell.ws.close(4000, 'replaced by a newer shell connection');
      this.shell = conn;
      if (this.shellLostTimer) {
        clearTimeout(this.shellLostTimer);
        this.shellLostTimer = null;
      }
      this.opts.onShellConnected?.();
    }
    this.opts.logger.info('rpc client connected', { role, conn: conn.id });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return; // clients never send binary frames
      void this.onMessage(conn, data.toString());
    });
    ws.on('close', () => {
      this.conns.delete(conn.id);
      if (this.shell === conn) {
        this.shell = null;
        this.armShellWatchdog();
      }
    });
    ws.on('error', (e) => this.opts.logger.warn('rpc socket error', { error: e.message }));
  }

  private armShellWatchdog(): void {
    if (this.shellLostTimer || !this.opts.onShellLost) return;
    this.shellLostTimer = setTimeout(() => {
      this.shellLostTimer = null;
      if (!this.shell) this.opts.onShellLost?.();
    }, this.opts.shellGraceMs ?? 10_000);
  }

  private send(conn: Conn, msg: RpcMessage): void {
    if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(JSON.stringify(msg));
  }

  private async onMessage(conn: Conn, raw: string): Promise<void> {
    let msg: RpcMessage;
    try {
      msg = JSON.parse(raw) as RpcMessage;
    } catch {
      this.send(conn, { jsonrpc: JSONRPC, id: 0, error: { code: RpcErrorCode.parse, message: 'parse error' } });
      return;
    }
    if (!msg || typeof msg !== 'object' || (msg as { jsonrpc?: unknown }).jsonrpc !== JSONRPC) {
      this.send(conn, {
        jsonrpc: JSONRPC,
        id: 0,
        error: { code: RpcErrorCode.invalidRequest, message: 'invalid request' },
      });
      return;
    }
    // Response to one of our host.* requests (only accepted from the shell connection).
    if ('id' in msg && !('method' in msg)) {
      if (conn.role !== 'shell') return;
      const res = msg as RpcResponse;
      const p = this.pending.get(String(res.id));
      if (!p) return;
      this.pending.delete(String(res.id));
      clearTimeout(p.timer);
      if (res.error) p.reject(new RpcError(res.error.code, res.error.message, res.error.data));
      else p.resolve(res.result);
      return;
    }
    const id = 'id' in msg ? msg.id : undefined;
    const method = (msg as { method?: unknown }).method;
    const reply = (r: { result?: unknown; error?: RpcResponse['error'] }) => {
      if (id !== undefined && id !== null) this.send(conn, { jsonrpc: JSONRPC, id, ...r });
    };
    if (typeof method !== 'string') {
      reply({ error: { code: RpcErrorCode.invalidRequest, message: 'missing method' } });
      return;
    }
    const spec = this.methods.get(method);
    if (!spec) {
      reply({ error: { code: RpcErrorCode.methodNotFound, message: `unknown method ${method}` } });
      return;
    }
    if (!spec.roles.includes(conn.role)) {
      reply({ error: { code: RpcErrorCode.unauthorized, message: `role ${conn.role} may not call ${method}` } });
      return;
    }
    const parsed = spec.schema.safeParse((msg as { params?: unknown }).params ?? {});
    if (!parsed.success) {
      reply({
        error: {
          code: RpcErrorCode.invalidParams,
          message: 'invalid params',
          data: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
      return;
    }
    try {
      const ctx: CallContext = { role: conn.role, connId: conn.id };
      if (conn.sessionId) ctx.callerSessionId = conn.sessionId;
      const result = await spec.handler(parsed.data as never, ctx);
      reply({ result: result ?? null });
    } catch (e) {
      if (e instanceof RpcError) reply({ error: { code: e.code, message: e.message, data: e.data } });
      else {
        this.opts.logger.error('rpc handler failed', { method, error: e });
        reply({ error: { code: RpcErrorCode.internal, message: e instanceof Error ? e.message : 'internal error' } });
      }
    }
  }

  // ───────── UiSink ─────────

  emit(event: UiEvent, payload: unknown): void {
    const msg = JSON.stringify({ jsonrpc: JSONRPC, method: event, params: payload });
    for (const c of this.conns.values()) {
      if (c.role === 'ui' || (c.role === 'shell' && SHELL_EVENTS.includes(event))) {
        if (c.ws.readyState === c.ws.OPEN) c.ws.send(msg);
      }
    }
  }

  // ───────── HostClient ─────────

  get connected(): boolean {
    return !!this.shell;
  }

  call<M extends HostMethod>(
    method: M,
    params: HostMethods[M]['params'],
    timeoutMs?: number,
  ): Promise<HostMethods[M]['result']> {
    const shell = this.shell;
    if (!shell) return Promise.reject(new RpcError(RpcErrorCode.notAvailable, `shell not connected (${method})`));
    const id = `h${++this.seq}`;
    const ms = timeoutMs ?? HOST_TIMEOUTS[method] ?? DEFAULT_HOST_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcError(RpcErrorCode.internal, `${method} timed out after ${ms} ms`));
      }, ms);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.send(shell, { jsonrpc: JSONRPC, id, method, params });
    });
  }

  sendAudio(utteranceId: string, chunk: Uint8Array): void {
    const shell = this.shell;
    if (shell && shell.ws.readyState === shell.ws.OPEN) shell.ws.send(encodeAudioFrame(utteranceId, chunk));
  }

  clientCount(role?: Role): number {
    let n = 0;
    for (const c of this.conns.values()) if (!role || c.role === role) n++;
    return n;
  }
}
