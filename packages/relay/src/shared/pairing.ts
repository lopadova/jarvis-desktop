/**
 * Pairing and link-protocol primitives shared by the Cloudflare and Vercel relays.
 * Runtime-agnostic: Web Crypto + plain TypeScript only. See docs/architecture/relay-protocol.md.
 */

export const LIMITS = {
  /** Max size of one WebSocket frame / long-poll message and of tool arguments. */
  maxFrameBytes: 64 * 1024,
  /** Max HTTP body for /mcp (a JSON-RPC envelope around ≤ 64 KB of arguments). */
  maxMcpBodyBytes: 80 * 1024,
  callsPerMinute: 60,
  callTimeoutMs: 120_000,
  maxHelloTools: 64,
} as const;

export const PAIR_ID_RE = /^[a-z2-7]{26}$/;
export const SECRET_HASH_RE = /^[0-9a-f]{64}$/;
export const PAIRING_CODE_RE = /^[A-Z2-7]{8}$/;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, uppercase, no padding. */
export function base32(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** sha256 over the UTF-8 bytes of `text`, lowercase hex. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(digest));
}

/** The code the desktop shows: first 8 chars of base32(sha256(secret)), derived here from the stored hash. */
export function pairingCodeFromHash(secretHashHex: string): string {
  return base32(hexToBytes(secretHashHex)).slice(0, 8);
}

/** Accepts what a person types ("abcd-efgh", "ABCD EFGH") and returns the canonical code, or null. */
export function normalizePairingCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  return PAIRING_CODE_RE.test(code) ? code : null;
}

/** Constant-time comparison for equal-length ASCII strings (hex digests). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function secretMatches(secret: string, secretHashHex: string): Promise<boolean> {
  return timingSafeEqual(await sha256Hex(secret), secretHashHex);
}

export function bearerToken(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  return match?.[1] ?? null;
}

export interface PairRegistration {
  pairId: string;
  secretHash: string;
  label: string;
}

/** Validates the body of `POST /pair/register`. Returns an error message on failure. */
export function parseRegistration(body: unknown): PairRegistration | string {
  if (!body || typeof body !== 'object') return 'Body must be a JSON object';
  const { pairId, secretHash, label } = body as Record<string, unknown>;
  if (typeof pairId !== 'string' || !PAIR_ID_RE.test(pairId)) return 'pairId must be 26 base32 (a-z, 2-7) characters';
  if (typeof secretHash !== 'string' || !SECRET_HASH_RE.test(secretHash)) return 'secretHash must be 64 lowercase hex';
  if (label !== undefined && typeof label !== 'string') return 'label must be a string';
  const cleanLabel = (label ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 80);
  return { pairId, secretHash, label: cleanLabel };
}

// ───────── link messages (desktop ⇄ relay), same shapes over WebSocket and long-polling ─────────

export interface HelloTool {
  name: string;
  readOnly?: boolean;
}
export interface HelloMessage {
  type: 'hello';
  version: string;
  tools: HelloTool[];
}
export interface CallMessage {
  type: 'call';
  id: string;
  tool: string;
  args: Record<string, unknown>;
  client: string;
}
export interface ResultMessage {
  type: 'result';
  id: string;
  ok: boolean;
  content?: unknown[];
  error?: string;
}
export interface PingMessage {
  type: 'ping' | 'pong';
  t: number;
}
export type DesktopMessage = HelloMessage | ResultMessage | PingMessage;

/** Parses and validates a desktop → relay message. Returns null for anything malformed. */
export function parseDesktopMessage(raw: string): DesktopMessage | null {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;
  switch (msg.type) {
    case 'hello': {
      if (!Array.isArray(msg.tools)) return null;
      const tools = msg.tools
        .filter((t): t is HelloTool => !!t && typeof t === 'object' && typeof (t as HelloTool).name === 'string')
        .slice(0, LIMITS.maxHelloTools)
        .map((t) => ({ name: t.name.slice(0, 64), readOnly: t.readOnly === true }));
      return { type: 'hello', version: String(msg.version ?? '').slice(0, 32), tools };
    }
    case 'result':
      if (typeof msg.id !== 'string' || typeof msg.ok !== 'boolean') return null;
      return {
        type: 'result',
        id: msg.id,
        ok: msg.ok,
        content: Array.isArray(msg.content) ? msg.content : [],
        error: typeof msg.error === 'string' ? msg.error.slice(0, 2000) : undefined,
      };
    case 'ping':
    case 'pong':
      return { type: msg.type, t: typeof msg.t === 'number' ? msg.t : Date.now() };
    default:
      return null;
  }
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}
