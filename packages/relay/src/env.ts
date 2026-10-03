import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import type { DesktopLink } from './desktop-link.js';
import type { PairRegistry } from './registry.js';

export interface Env {
  /** OAuth clients, grants and tokens (required binding name for workers-oauth-provider). */
  OAUTH_KV: KVNamespace;
  /** One Durable Object per pairId: holds the desktop WebSocket (hibernation API). */
  DESKTOP_LINK: DurableObjectNamespace<DesktopLink>;
  /** Single Durable Object holding pair records (pairId, secret hash, pairing-code index, label). */
  PAIR_REGISTRY: DurableObjectNamespace<PairRegistry>;
  /** Injected by OAuthProvider into the default handler's env. */
  OAUTH_PROVIDER: OAuthHelpers;
  /** Relay-side timeout for one tool call, in ms (default 120000). */
  CALL_TIMEOUT_MS?: string;
  /** Max tool calls per minute per pair (default 60). */
  CALLS_PER_MINUTE?: string;
  /** Canonical public origin (e.g. https://jarvis-relay.me.workers.dev). Default: the request origin. */
  PUBLIC_URL?: string;
}

/** OAuth grant props: the grant is bound to one paired desktop and to that registration. */
export interface GrantProps {
  pairId: string;
  /** Nonce of the registration the grant was issued for; grants from an earlier registration are rejected. */
  generation: string;
}

export function registryStub(env: Env) {
  return env.PAIR_REGISTRY.get(env.PAIR_REGISTRY.idFromName('registry'));
}

export function linkStub(env: Env, pairId: string) {
  return env.DESKTOP_LINK.get(env.DESKTOP_LINK.idFromName(pairId));
}
