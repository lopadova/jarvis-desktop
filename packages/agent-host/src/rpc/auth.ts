/**
 * Connection authentication for the loopback RPC server (ADR 0002).
 *
 * Browsers (the Tauri webview) cannot set an Authorization header on a WebSocket, so the token travels
 * in the `Sec-WebSocket-Protocol` header as the single subprotocol `jarvis.<token>`
 * (`new WebSocket(url, ['jarvis.' + token])`). The server echoes the same value back, as RFC 6455
 * requires. The role is chosen with the query string `?role=ui|shell|mcp` (default `ui`):
 *  - `ui` and `shell` must present the launch token (env JARVIS_LAUNCH_TOKEN);
 *  - `mcp` must present the per-run `mcpToken` from the connection file and may only call `mcp.call`.
 * Tokens are compared in constant time. Requests carrying a non-allowlisted Origin are refused
 * (blocks browsers and DNS rebinding); clients without an Origin (Rust, CLI, MCP bridge) are fine.
 */
import type { Role } from '@jarvis/core';
import { safeEqual } from '../util.js';

export const PROTOCOL_PREFIX = 'jarvis.';

export const ALLOWED_ORIGINS: readonly string[] = [
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
  'http://localhost:1420',
];

export interface AuthConfig {
  launchToken: string;
  mcpToken: string;
  extraOrigins?: readonly string[];
  /**
   * Per-session MCP tokens: an agent session's bridge authenticates with its own token, and the
   * session id is derived from it (never from anything the client declares). Returns the session id.
   */
  resolveSessionToken?: (token: string) => string | undefined;
}

export type AuthResult =
  | { ok: true; role: Role; protocol: string; sessionId?: string }
  | { ok: false; status: 401 | 403; reason: string };

export function originAllowed(origin: string | undefined, extra: readonly string[] = []): boolean {
  if (origin === undefined || origin === '') return true;
  return ALLOWED_ORIGINS.includes(origin) || extra.includes(origin);
}

export function parseProtocols(header: string | string[] | undefined): string[] {
  const raw = Array.isArray(header) ? header.join(',') : (header ?? '');
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function authenticate(cfg: AuthConfig, req: { origin?: string; url?: string; protocols: string[] }): AuthResult {
  if (!originAllowed(req.origin, cfg.extraOrigins)) return { ok: false, status: 403, reason: 'origin not allowed' };
  let role: Role = 'ui';
  try {
    const r = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('role');
    if (r === 'ui' || r === 'shell' || r === 'mcp') role = r;
    else if (r !== null) return { ok: false, status: 401, reason: 'unknown role' };
  } catch {
    return { ok: false, status: 401, reason: 'bad url' };
  }
  const proto = req.protocols.find((p) => p.startsWith(PROTOCOL_PREFIX));
  if (!proto) return { ok: false, status: 401, reason: 'missing token' };
  const token = proto.slice(PROTOCOL_PREFIX.length);
  if (role === 'mcp') {
    if (safeEqual(token, cfg.mcpToken)) return { ok: true, role, protocol: proto };
    // Session tokens are 256-bit random values; a Map lookup's timing reveals nothing useful.
    const sessionId = token.length >= 32 ? cfg.resolveSessionToken?.(token) : undefined;
    if (sessionId) return { ok: true, role, protocol: proto, sessionId };
    return { ok: false, status: 401, reason: 'bad token' };
  }
  if (!safeEqual(token, cfg.launchToken)) return { ok: false, status: 401, reason: 'bad token' };
  return { ok: true, role, protocol: proto };
}
