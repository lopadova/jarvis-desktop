/**
 * DesktopLink — one SQLite-backed Durable Object per paired desktop (named by pairId).
 *
 * Holds the desktop's outbound WebSocket with the Hibernation API: while nobody calls a tool the
 * object is evicted from memory and costs no duration. A tool call (RPC from the Worker) sends a
 * `call` frame and awaits the matching `result`; the pending promise lives only in memory, and the
 * in-flight RPC keeps the object awake until it settles. Arguments and results are never stored.
 */
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env.js';
import { OFFLINE_TEXT, type ToolResult, textResult } from './shared/mcp.js';
import { byteLength, type HelloMessage, LIMITS, parseDesktopMessage } from './shared/pairing.js';

const DESKTOP_TAG = 'desktop';

interface Pending {
  resolve: (result: ToolResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface RateWindow {
  minute: number;
  count: number;
}

export class DesktopLink extends DurableObject<Env> {
  private readonly pending = new Map<string, Pending>();

  /** Marks this pair as registered with its generation nonce (called by POST /pair/register). */
  async activate(generation: string): Promise<void> {
    await this.ctx.storage.put('generation', generation);
  }

  /** True when an OAuth grant issued for `generation` may use this pair. */
  async acceptsGeneration(generation: string): Promise<boolean> {
    const current = await this.ctx.storage.get<string>('generation');
    return typeof current === 'string' && current === generation;
  }

  /** Unpairs: closes the socket and forgets everything. */
  async deactivate(): Promise<void> {
    for (const ws of this.ctx.getWebSockets(DESKTOP_TAG)) this.safeClose(ws, 4001, 'Unpaired');
    this.failAll('This connector is no longer paired with Jarvis');
    await this.ctx.storage.deleteAll();
  }

  async isOnline(): Promise<boolean> {
    return this.openSockets().length > 0;
  }

  /** Tool names from the desktop's last `hello` (kept across hibernation and reconnects). */
  async exposedTools(): Promise<string[]> {
    if (!(await this.ctx.storage.get<string>('generation'))) return [];
    const hello = await this.ctx.storage.get<HelloMessage>('hello');
    return hello?.tools.map((tool) => tool.name) ?? [];
  }

  async callTool(tool: string, args: Record<string, unknown>, client: string): Promise<ToolResult> {
    if (!(await this.ctx.storage.get<string>('generation'))) {
      return textResult('This connector is not paired with Jarvis. Pair it again from the Jarvis settings.', true);
    }
    if (!(await this.takeRateToken())) {
      return textResult(`Too many calls: at most ${this.callsPerMinute()} per minute. Try again shortly.`, true);
    }
    const socket = this.openSockets()[0];
    if (!socket) return textResult(OFFLINE_TEXT, true);

    const id = crypto.randomUUID();
    const frame = JSON.stringify({ type: 'call', id, tool, args, client });
    if (byteLength(frame) > LIMITS.maxFrameBytes) return textResult('Arguments are larger than 64 KB', true);

    const timeoutMs = Number(this.env.CALL_TIMEOUT_MS) || LIMITS.callTimeoutMs;
    return new Promise<ToolResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(textResult(`Jarvis did not answer within ${Math.round(timeoutMs / 1000)} s`, true));
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      try {
        socket.send(frame);
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve(textResult(OFFLINE_TEXT, true));
      }
    });
  }

  /** WebSocket upgrade, already authenticated by the Worker. */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    // Only one desktop per pair: a newer connection replaces the older one.
    for (const ws of this.ctx.getWebSockets(DESKTOP_TAG)) this.safeClose(ws, 4000, 'Replaced by a newer connection');
    this.failAll(OFFLINE_TEXT);

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [DESKTOP_TAG]);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return this.safeClose(ws, 1003, 'Text frames only');
    if (byteLength(message) > LIMITS.maxFrameBytes) return this.safeClose(ws, 1009, 'Frame larger than 64 KB');
    const msg = parseDesktopMessage(message);
    if (!msg) return;
    switch (msg.type) {
      case 'hello':
        await this.ctx.storage.put('hello', msg);
        return;
      case 'result': {
        const pending = this.pending.get(msg.id);
        if (!pending) return; // late answer after a timeout
        this.pending.delete(msg.id);
        clearTimeout(pending.timer);
        pending.resolve(
          msg.ok ? { content: msg.content ?? [] } : textResult(msg.error || 'Jarvis could not run the tool', true),
        );
        return;
      }
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
        return;
      default:
        return;
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.safeClose(ws, code === 1005 || code === 1006 ? 1000 : code, reason);
    if (this.openSockets().every((other) => other === ws)) this.failAll(OFFLINE_TEXT);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws, 1011, 'error');
  }

  private openSockets(): WebSocket[] {
    return this.ctx.getWebSockets(DESKTOP_TAG).filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  private callsPerMinute(): number {
    return Number(this.env.CALLS_PER_MINUTE) || LIMITS.callsPerMinute;
  }

  /** Fixed one-minute window, persisted so it survives hibernation. */
  private async takeRateToken(): Promise<boolean> {
    const minute = Math.floor(Date.now() / 60_000);
    const current = await this.ctx.storage.get<RateWindow>('rate');
    const count = current?.minute === minute ? current.count : 0;
    if (count >= this.callsPerMinute()) return false;
    await this.ctx.storage.put('rate', { minute, count: count + 1 } satisfies RateWindow);
    return true;
  }

  private failAll(text: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve(textResult(text, true));
      this.pending.delete(id);
    }
  }

  private safeClose(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
  }
}
