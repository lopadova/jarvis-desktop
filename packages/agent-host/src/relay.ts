/**
 * Relay link client (docs/architecture/relay-protocol.md, ADR 0005, security-model R9).
 * - Pairing: random pairId (16 bytes, base32 lowercase) + secret (32 bytes, base64url) stored in the OS
 *   keyring; only sha256(secret) (hex over the UTF-8 bytes of the base64url string, §5) is sent to the
 *   relay. The pairing code is the first 8 chars of base32(sha256(secret)), uppercase.
 * - Unpairing calls `DELETE /pair/register?pairId=` with the bearer secret, so the relay revokes every
 *   OAuth grant and tombstones the pairId. Re-pairing always uses a new pairId.
 * - One outbound WebSocket (no inbound ports), `Authorization: Bearer <secret>`, `hello` with the tools
 *   we expose (read-only unless the user enabled write tools), `call` → MCP handler → `result`,
 *   ping every 30 s with a pong watchdog, reconnect with exponential backoff + jitter.
 * - Close codes (§5): 4000 = a newer desktop connection replaced this one → stay offline (no reconnect
 *   ping-pong between two computers); 4001 = unpaired on the relay → forget the pairing; 1009/1003 =
 *   protocol violation on our side → reconnect with backoff. An HTTP 401 on the upgrade means the
 *   relay no longer knows this pair → retry only at the slowest backoff.
 */
import { createHash, randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { type Logger, McpTools, SECRET_KEYS, type SecretStore, type Settings } from '@jarvis/core';
import WebSocket from 'ws';
import type { UiSink } from './host.js';
import { exposedTools, type McpCallInput, type McpResult } from './mcp-handler.js';
import { errorMessage } from './util.js';

export const RELAY_PROTOCOL_VERSION = '0.1.0';
/** Max frame size in bytes, both directions (§4). */
export const MAX_FRAME = 64 * 1024;

/** WebSocket close codes used by the reference relay (§5). */
export const CLOSE_REPLACED = 4000;
export const CLOSE_UNPAIRED = 4001;
export const CLOSE_TOO_LARGE = 1009;
export const CLOSE_UNSUPPORTED = 1003;

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
export function base32(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export const sha256Hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
export const pairingCode = (secret: string): string =>
  base32(createHash('sha256').update(secret, 'utf8').digest()).slice(0, 8).toUpperCase();

/** `status` stays within the four values the UI knows; `reason` explains an offline/unpaired state. */
export type RelayState = 'unpaired' | 'connecting' | 'connected' | 'offline';
export type RelayReason = 'replaced' | 'revoked' | 'auth-failed' | 'protocol-error' | 'network';

export interface RelayStatus {
  status: RelayState;
  reason?: RelayReason;
  relayUrl?: string;
  pairId?: string;
  code?: string;
  qr?: string;
  error?: string;
}

/** What the relay said when we unpaired: revoked now, already gone, or not reachable (local pairing is dropped anyway). */
export type RemoteUnpair = 'revoked' | 'already-gone' | 'unreachable' | 'not-paired';

interface StoredPairing {
  relayUrl: string;
  pairId: string;
  secret: string;
}

export interface RelayDeps {
  secrets: SecretStore;
  settings: () => Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  ui: UiSink;
  logger: Logger;
  call: (input: McpCallInput) => Promise<McpResult>;
  fetch?: typeof fetch;
  /** Injectable for tests. */
  connect?: (url: string, headers: Record<string, string>) => WebSocket;
  pingMs?: number;
  backoff?: { minMs: number; maxMs: number };
}

const byteLength = (s: string): number => Buffer.byteLength(s, 'utf8');

/** Cuts `text` so that its UTF-8 encoding is at most `maxBytes` (never splits a code point). */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) return text;
  const buf = Buffer.from(text, 'utf8').subarray(0, Math.max(0, maxBytes));
  let s = buf.toString('utf8');
  if (s.endsWith('�')) s = s.slice(0, -1);
  return s;
}

/** Serialises a `result` frame that is guaranteed to fit in MAX_FRAME bytes (the relay closes with 1009 otherwise). */
export function resultFrame(id: string, res: McpResult): string {
  const texts = res.content.map((c) => c.text);
  const build = (parts: string[]) =>
    JSON.stringify(
      res.isError
        ? { type: 'result', id, ok: false, error: parts.join('\n').slice(0, 2000) }
        : { type: 'result', id, ok: true, content: parts.map((text) => ({ type: 'text', text })) },
    );
  let frame = build(texts);
  if (byteLength(frame) <= MAX_FRAME) return frame;
  // Too big: keep the first parts, shrink by the overflow (JSON escaping can only grow it, so loop).
  const marker = '\n…[truncated by Jarvis: the result was larger than 64 KB]';
  let joined = texts.join('\n\n');
  let budget = MAX_FRAME - 512;
  for (let i = 0; i < 8; i++) {
    joined = truncateUtf8(joined, budget);
    frame = build([joined + marker]);
    const over = byteLength(frame) - MAX_FRAME;
    if (over <= 0) return frame;
    budget -= over + 256;
  }
  return build(['The result was too large to send through the relay.']);
}

export class RelayClient {
  private ws: WebSocket | null = null;
  private pairing: StoredPairing | null = null;
  private state: RelayState = 'unpaired';
  private reason: RelayReason | undefined;
  private lastError: string | undefined;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private awaitingPong = false;
  private stopped = true;

  constructor(private readonly deps: RelayDeps) {}

  status(): RelayStatus {
    const s: RelayStatus = { status: this.state };
    if (this.reason) s.reason = this.reason;
    if (this.pairing) {
      s.relayUrl = this.pairing.relayUrl;
      s.pairId = this.pairing.pairId;
      s.code = pairingCode(this.pairing.secret);
      s.qr = `${this.pairing.relayUrl}/connect?pair=${this.pairing.pairId}`;
    }
    if (this.lastError) s.error = this.lastError;
    return s;
  }

  private setState(state: RelayState, reason?: RelayReason, error?: string): void {
    this.state = state;
    this.reason = reason;
    this.lastError = error;
    this.deps.ui.emit('ui.relay', this.status());
  }

  /** Loads a stored pairing and connects (called at startup). */
  async start(): Promise<void> {
    try {
      const raw = await this.deps.secrets.get(SECRET_KEYS.relaySecret);
      if (raw) this.pairing = JSON.parse(raw) as StoredPairing;
    } catch (e) {
      this.deps.logger.warn('relay pairing unavailable', { error: errorMessage(e) });
    }
    if (this.pairing) this.connect();
    else this.setState('unpaired');
  }

  async pair(relayUrl: string): Promise<{ code: string; qr: string; pairId: string; relayUrl: string }> {
    const base = relayUrl.replace(/\/+$/, '');
    const u = new URL(base);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) {
      throw new Error('the relay URL must use https');
    }
    // An earlier pairing is revoked on its relay first, so its OAuth grants stop working.
    if (this.pairing) await this.unpair();
    const f = this.deps.fetch ?? fetch;
    const secret = randomBytes(32).toString('base64url');
    for (let i = 0; i < 3; i++) {
      const pairId = base32(randomBytes(16));
      const res = await f(`${base}/pair/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pairId, secretHash: sha256Hex(secret), label: `Jarvis on ${hostname()}`.slice(0, 80) }),
      });
      if (res.status === 409) continue;
      if (res.status === 429) throw new Error('the relay refused the registration: too many pairings, try later');
      if (res.status !== 201) throw new Error(`relay registration failed (HTTP ${res.status})`);
      this.pairing = { relayUrl: base, pairId, secret };
      await this.deps.secrets.set(SECRET_KEYS.relaySecret, JSON.stringify(this.pairing));
      this.deps.updateSettings({ relayUrl: base });
      this.disconnect();
      this.attempt = 0;
      this.connect();
      return { code: pairingCode(secret), qr: `${base}/connect?pair=${pairId}`, pairId, relayUrl: base };
    }
    throw new Error('relay registration failed: pair id collision');
  }

  /**
   * Unpairs: asks the relay to revoke the pairing (`DELETE /pair/register`, bearer secret), then forgets
   * it locally. The local pairing is dropped even if the relay is unreachable.
   */
  async unpair(): Promise<{ remote: RemoteUnpair }> {
    this.disconnect();
    const p = this.pairing;
    let remote: RemoteUnpair = 'not-paired';
    if (p) {
      const f = this.deps.fetch ?? fetch;
      try {
        const res = await f(`${p.relayUrl}/pair/register?pairId=${encodeURIComponent(p.pairId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${p.secret}` },
          signal: AbortSignal.timeout(10_000),
        });
        // 401: the relay no longer knows this pair (already unpaired or its storage was reset).
        remote = res.status === 204 || res.ok ? 'revoked' : res.status === 401 ? 'already-gone' : 'unreachable';
        if (remote === 'unreachable') this.deps.logger.warn('relay unpair failed', { status: res.status });
      } catch (e) {
        remote = 'unreachable';
        this.deps.logger.warn('relay unpair failed', { error: errorMessage(e) });
      }
    }
    await this.forget();
    this.setState('unpaired');
    return { remote };
  }

  private async forget(): Promise<void> {
    this.pairing = null;
    await this.deps.secrets.delete(SECRET_KEYS.relaySecret);
    this.deps.updateSettings({ relayUrl: '' });
  }

  stop(): void {
    this.disconnect();
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.awaitingPong = false;
  }

  private disconnect(): void {
    this.stopped = true;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.removeAllListeners();
      ws.on('error', () => undefined);
      ws.terminate();
    }
  }

  private connect(): void {
    if (!this.pairing) return;
    this.stopped = false;
    const p = this.pairing;
    const url = `${p.relayUrl.replace(/^http/, 'ws')}/desktop/connect?pairId=${encodeURIComponent(p.pairId)}`;
    this.setState('connecting');
    const headers = { Authorization: `Bearer ${p.secret}` };
    const ws = this.deps.connect
      ? this.deps.connect(url, headers)
      : new WebSocket(url, { headers, maxPayload: MAX_FRAME });
    this.ws = ws;
    let httpStatus: number | undefined;
    // Every handler checks that this socket is still the current one: a late event from an older
    // socket must never tear down the newer connection.
    const current = () => this.ws === ws;
    ws.on('open', () => {
      if (!current()) return;
      this.attempt = 0;
      this.setState('connected');
      this.send({ type: 'hello', version: RELAY_PROTOCOL_VERSION, tools: this.helloTools() });
      this.pingTimer = setInterval(() => this.heartbeat(ws), this.deps.pingMs ?? 30_000);
      this.pingTimer.unref?.();
    });
    ws.on('message', (data, isBinary) => {
      if (!current() || isBinary) return;
      void this.onMessage(data.toString());
    });
    ws.on('unexpected-response', (_req, res) => {
      httpStatus = res.statusCode;
      res.resume();
      ws.terminate();
    });
    ws.on('close', (code, reason) => {
      if (current()) this.onClose(code, reason.toString(), httpStatus);
    });
    ws.on('error', (e) => {
      if (!current()) return;
      this.lastError = e.message;
      this.deps.logger.warn('relay socket error', { error: e.message });
    });
  }

  /** Sends a ping; if the previous one got no pong, the link is dead → reconnect. */
  private heartbeat(ws: WebSocket): void {
    if (this.ws !== ws) return;
    if (this.awaitingPong) {
      this.deps.logger.warn('relay did not answer the last ping, reconnecting');
      ws.terminate();
      return;
    }
    this.awaitingPong = true;
    this.send({ type: 'ping', t: Date.now() });
  }

  helloTools(): { name: string; readOnly: boolean; destructive: boolean }[] {
    return exposedTools('relay', this.deps.settings()).map((name) => ({
      name,
      readOnly: McpTools[name].readOnly,
      destructive: McpTools[name].destructive,
    }));
  }

  /** Re-announces tools (e.g. after `relayExposeWriteTools` changes). */
  refreshHello(): void {
    if (this.state === 'connected')
      this.send({ type: 'hello', version: RELAY_PROTOCOL_VERSION, tools: this.helloTools() });
  }

  private onClose(code: number, reasonText: string, httpStatus?: number): void {
    this.clearTimers();
    this.ws = null;
    if (this.stopped) return;
    if (code === CLOSE_REPLACED) {
      // Another Jarvis (or a newer connection) took over this pair; reconnecting would kick it out again.
      this.stopped = true;
      this.deps.logger.warn('relay link replaced by a newer connection');
      this.setState('offline', 'replaced', 'Another connection to this relay pairing replaced this one');
      return;
    }
    if (code === CLOSE_UNPAIRED) {
      this.stopped = true;
      this.deps.logger.warn('relay pairing revoked by the relay');
      void this.forget()
        .catch((e) => this.deps.logger.warn('relay forget failed', { error: errorMessage(e) }))
        .finally(() => this.setState('unpaired', 'revoked', 'This computer was unpaired on the relay'));
      return;
    }
    const { minMs, maxMs } = this.deps.backoff ?? { minMs: 1_000, maxMs: 60_000 };
    let reason: RelayReason = 'network';
    let error = this.lastError;
    let base = Math.min(maxMs, minMs * 2 ** this.attempt);
    if (httpStatus === 401 || httpStatus === 403) {
      reason = 'auth-failed';
      error = 'The relay no longer accepts this pairing; pair again';
      base = maxMs;
    } else if (code === CLOSE_TOO_LARGE || code === CLOSE_UNSUPPORTED) {
      reason = 'protocol-error';
      error = `The relay closed the link (${code} ${reasonText || 'protocol error'})`;
      this.deps.logger.error('relay closed the link for a protocol violation', { code, reason: reasonText });
    } else if (httpStatus) {
      error = `The relay answered HTTP ${httpStatus}`;
    }
    this.setState('offline', reason, error);
    const delay = base * (0.75 + Math.random() * 0.5);
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private send(msg: unknown): void {
    this.sendRaw(JSON.stringify(msg));
  }

  private sendRaw(frame: string): void {
    if (byteLength(frame) > MAX_FRAME) {
      this.deps.logger.error('relay frame too large, dropped', { bytes: byteLength(frame) });
      return;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(frame);
  }

  private async onMessage(raw: string): Promise<void> {
    if (byteLength(raw) > MAX_FRAME) return;
    let msg: { type?: string; id?: string; tool?: string; args?: unknown; client?: string; t?: number };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'pong') {
      this.awaitingPong = false;
      return;
    }
    if (msg.type === 'ping') {
      this.send({ type: 'pong', t: msg.t });
      return;
    }
    if (msg.type !== 'call' || typeof msg.id !== 'string') return;
    const id = msg.id.slice(0, 64);
    const tool = msg.tool;
    if (typeof tool !== 'string' || !Object.hasOwn(McpTools, tool)) {
      this.send({ type: 'result', id, ok: false, error: 'unknown tool' });
      return;
    }
    if (!exposedTools('relay', this.deps.settings()).includes(tool as keyof typeof McpTools)) {
      this.send({ type: 'result', id, ok: false, error: 'tool not exposed on the relay' });
      return;
    }
    try {
      const input: McpCallInput = {
        tool: tool as keyof typeof McpTools,
        args:
          msg.args && typeof msg.args === 'object' && !Array.isArray(msg.args)
            ? (msg.args as Record<string, unknown>)
            : {},
        origin: 'relay',
      };
      if (typeof msg.client === 'string') input.client = msg.client.slice(0, 120);
      this.sendRaw(resultFrame(id, await this.deps.call(input)));
    } catch (e) {
      this.send({ type: 'result', id, ok: false, error: errorMessage(e).slice(0, 2000) });
    }
  }
}
