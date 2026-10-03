/**
 * Relay link client (docs/architecture/relay-protocol.md, ADR 0005, security-model R9).
 * - Pairing: random pairId (16 bytes, base32 lowercase) + secret (32 bytes, base64url) stored in the OS
 *   keyring; only sha256(secret) is sent to the relay. The pairing code is the first 8 chars of
 *   base32(sha256(secret)), uppercase.
 * - One outbound WebSocket (no inbound ports), `Authorization: Bearer <secret>`, `hello` with the tools
 *   we expose (read-only unless the user enabled write tools), `call` → MCP handler → `result`,
 *   ping/pong every 30 s, reconnect with exponential backoff + jitter.
 */
import { createHash, randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { type Logger, McpTools, SECRET_KEYS, type SecretStore, type Settings } from '@jarvis/core';
import WebSocket from 'ws';
import type { UiSink } from './host.js';
import { exposedTools, type McpCallInput, type McpResult } from './mcp-handler.js';
import { errorMessage } from './util.js';

export const RELAY_PROTOCOL_VERSION = '0.1.0';
export const MAX_FRAME = 64 * 1024;

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

export const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');
export const pairingCode = (secret: string): string =>
  base32(createHash('sha256').update(secret).digest()).slice(0, 8).toUpperCase();

export type RelayState = 'unpaired' | 'connecting' | 'connected' | 'offline';

export interface RelayStatus {
  status: RelayState;
  relayUrl?: string;
  pairId?: string;
  code?: string;
  qr?: string;
  error?: string;
}

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

export class RelayClient {
  private ws: WebSocket | null = null;
  private pairing: StoredPairing | null = null;
  private state: RelayState = 'unpaired';
  private lastError: string | undefined;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = true;

  constructor(private readonly deps: RelayDeps) {}

  status(): RelayStatus {
    const s: RelayStatus = { status: this.state };
    if (this.pairing) {
      s.relayUrl = this.pairing.relayUrl;
      s.pairId = this.pairing.pairId;
      s.code = pairingCode(this.pairing.secret);
      s.qr = `${this.pairing.relayUrl}/connect?pair=${this.pairing.pairId}`;
    }
    if (this.lastError) s.error = this.lastError;
    return s;
  }

  private setState(state: RelayState, error?: string): void {
    this.state = state;
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
      if (res.status !== 201 && !res.ok) throw new Error(`relay registration failed (HTTP ${res.status})`);
      this.pairing = { relayUrl: base, pairId, secret };
      await this.deps.secrets.set(SECRET_KEYS.relaySecret, JSON.stringify(this.pairing));
      this.deps.updateSettings({ relayUrl: base });
      this.disconnect();
      this.connect();
      return { code: pairingCode(secret), qr: `${base}/connect?pair=${pairId}`, pairId, relayUrl: base };
    }
    throw new Error('relay registration failed: pair id collision');
  }

  async unpair(): Promise<void> {
    this.disconnect();
    this.pairing = null;
    await this.deps.secrets.delete(SECRET_KEYS.relaySecret);
    this.deps.updateSettings({ relayUrl: '' });
    this.setState('unpaired');
  }

  stop(): void {
    this.disconnect();
  }

  private disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.reconnectTimer = null;
    this.pingTimer = null;
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
    ws.on('open', () => {
      this.attempt = 0;
      this.setState('connected');
      this.send({ type: 'hello', version: RELAY_PROTOCOL_VERSION, tools: this.helloTools() });
      this.pingTimer = setInterval(() => this.send({ type: 'ping', t: Date.now() }), this.deps.pingMs ?? 30_000);
      this.pingTimer.unref?.();
    });
    ws.on('message', (data) => void this.onMessage(data.toString()));
    ws.on('close', () => this.onClose());
    ws.on('error', (e) => {
      this.lastError = e.message;
      this.deps.logger.warn('relay socket error', { error: e.message });
    });
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

  private onClose(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.ws = null;
    if (this.stopped) return;
    this.setState('offline', this.lastError);
    const { minMs, maxMs } = this.deps.backoff ?? { minMs: 1_000, maxMs: 60_000 };
    const delay = Math.min(maxMs, minMs * 2 ** this.attempt) * (0.75 + Math.random() * 0.5);
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private send(msg: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private async onMessage(raw: string): Promise<void> {
    if (raw.length > MAX_FRAME) return;
    let msg: { type?: string; id?: string; tool?: string; args?: unknown; client?: string; t?: number };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === 'ping') {
      this.send({ type: 'pong', t: msg.t });
      return;
    }
    if (msg.type !== 'call' || typeof msg.id !== 'string') return;
    const id = msg.id;
    const tool = msg.tool;
    if (typeof tool !== 'string' || !(tool in McpTools)) {
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
        args: msg.args && typeof msg.args === 'object' ? (msg.args as Record<string, unknown>) : {},
        origin: 'relay',
      };
      if (typeof msg.client === 'string') input.client = msg.client.slice(0, 120);
      const res = await this.deps.call(input);
      const content = res.content.map((c) => ({ type: 'text', text: c.text.slice(0, MAX_FRAME - 1024) }));
      if (res.isError) this.send({ type: 'result', id, ok: false, error: content.map((c) => c.text).join('\n') });
      else this.send({ type: 'result', id, ok: true, content });
    } catch (e) {
      this.send({ type: 'result', id, ok: false, error: errorMessage(e) });
    }
  }
}
