/**
 * Minimal JSON-RPC 2.0 client for the Jarvis sidecar ("agent-host"), role `mcp`.
 *
 * - The connection details come from `run/agent-host.json` in the Jarvis data dir (re-read on every
 *   connect, so a restarted Jarvis with a new port/token is picked up automatically).
 * - Authentication uses the WebSocket subprotocol `jarvis.<mcpToken>`.
 * - The socket is opened lazily on the first call and re-opened after it drops.
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DATA_FILES, dataDir, JSONRPC, type OsName, type RpcResponse } from '@jarvis/core';
import WebSocket from 'ws';

export interface ConnectionInfo {
  port: number;
  mcpToken: string;
}

/** Returns the current connection info, or `null` when Jarvis is not running. */
export type ConnectionSource = () => Promise<ConnectionInfo | null>;

/** Jarvis is not running (no connection file, connection refused, or the socket was rejected). */
export class JarvisOfflineError extends Error {
  constructor(message = 'Jarvis is not running') {
    super(message);
    this.name = 'JarvisOfflineError';
  }
}

/** The call did not complete in time. */
export class JarvisTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Jarvis did not answer within ${Math.round(timeoutMs / 1000)} s`);
    this.name = 'JarvisTimeoutError';
  }
}

/** The sidecar answered with a JSON-RPC error. */
export class JarvisRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'JarvisRpcError';
  }
}

export function defaultConnectionFilePath(
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): string {
  const os: OsName = platform === 'darwin' || platform === 'win32' ? platform : 'linux';
  return join(dataDir(os, env, home), DATA_FILES.connection);
}

/** Reads `run/agent-host.json`; any problem (missing, partial write, bad JSON) means "offline". */
export function fileConnectionSource(path: string = defaultConnectionFilePath()): ConnectionSource {
  return async () => {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<ConnectionInfo>;
      if (typeof parsed.port !== 'number' || typeof parsed.mcpToken !== 'string' || !parsed.mcpToken) return null;
      return { port: parsed.port, mcpToken: parsed.mcpToken };
    } catch {
      return null;
    }
  };
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface SidecarClientOptions {
  /** How long to wait for the WebSocket handshake. Default 5 s. */
  connectTimeoutMs?: number;
  /** Host to connect to. The sidecar only listens on loopback. */
  host?: string;
}

export class SidecarClient {
  private socket: Promise<WebSocket> | null = null;
  private current: WebSocket | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;

  constructor(
    private readonly source: ConnectionSource,
    private readonly options: SidecarClientOptions = {},
  ) {}

  /** Sends a JSON-RPC request and resolves with its `result`. */
  async request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const ws = await this.connect();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new JarvisTimeoutError(timeoutMs));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ jsonrpc: JSONRPC, id, method, params }), (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new JarvisOfflineError(`Lost the connection to Jarvis: ${error.message}`));
      });
    });
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    this.current = null;
    this.failAll(new JarvisOfflineError('Connection closed'));
    void socket?.then((ws) => ws.close(1000)).catch(() => undefined);
  }

  private connect(): Promise<WebSocket> {
    this.socket ??= this.open().catch((error: unknown) => {
      this.socket = null;
      throw error;
    });
    return this.socket;
  }

  private async open(): Promise<WebSocket> {
    const info = await this.source();
    if (!info) throw new JarvisOfflineError();
    const host = this.options.host ?? '127.0.0.1';
    const ws = new WebSocket(`ws://${host}:${info.port}`, [`jarvis.${info.mcpToken}`], {
      handshakeTimeout: this.options.connectTimeoutMs ?? 5_000,
      perMessageDeflate: false,
    });
    await new Promise<void>((resolve, reject) => {
      const fail = (reason: string) => {
        ws.removeAllListeners('open');
        ws.terminate();
        reject(new JarvisOfflineError(reason));
      };
      ws.once('open', () => {
        ws.removeAllListeners('unexpected-response');
        resolve();
      });
      ws.once('unexpected-response', (_req, res) => fail(`Jarvis refused the connection (HTTP ${res.statusCode})`));
      ws.once('error', (error) => fail(`Cannot reach Jarvis: ${error.message}`));
    });
    ws.on('error', () => undefined); // reported through 'close'
    ws.on('message', (data) => this.onMessage(data.toString()));
    ws.on('close', () => {
      if (this.current !== ws) return;
      this.current = null;
      this.socket = null;
      this.failAll(new JarvisOfflineError('Jarvis closed the connection'));
    });
    this.current = ws;
    return ws;
  }

  private onMessage(raw: string): void {
    let message: Partial<RpcResponse>;
    try {
      message = JSON.parse(raw) as Partial<RpcResponse>;
    } catch {
      return;
    }
    if (typeof message.id !== 'number') return; // notifications are not used by the mcp role
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error)
      pending.reject(new JarvisRpcError(message.error.code, message.error.message, message.error.data));
    else pending.resolve(message.result);
  }

  private failAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}
