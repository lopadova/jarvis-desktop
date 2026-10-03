/**
 * Egress guard for the Home agent's web tool (security-model R5, T4).
 *
 * (a) Taint: once the run has read local/private data (files, clipboard, MCP output), every request to
 *     a host not yet approved in this run needs approval, whatever the method.
 * (b) Without taint, approval is still required when the host was neither said by the user nor
 *     approved earlier, when subdomain + path + query exceed a small budget or contain a high-entropy
 *     segment (a typical exfiltration channel), and for any non-GET method or body.
 * (c) Redirects are followed manually (max 5 hops) and every hop is re-validated.
 * (d) Loopback, private (RFC 1918), link-local, CGNAT, multicast, unique-local and metadata addresses
 *     are refused after DNS resolution; only http(s) is allowed.
 * (e) Responses are capped (2 MB) and handed to the brain as untrusted data by the caller.
 *
 * DNS rebinding: all resolved addresses are vetted and the request then connects to the vetted IP
 * (`pinnedFetch` connects to the IP with Host/SNI set to the name), so there is no second resolution.
 */
import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { domainToASCII } from 'node:url';
import ipaddr from 'ipaddr.js';
import { getDomain } from 'tldts';

export const EGRESS_BUDGET_CHARS = 100;
export const MAX_REDIRECTS = 5;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export type Resolver = (host: string) => Promise<string[]>;

export const dnsResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

const GLOBAL_V6 = ipaddr.IPv6.parse('2000::');

/**
 * True for addresses that must never be reached by the web tool. Parsed with ipaddr.js (handles hex,
 * octal and decimal IPv4 forms and every IPv6 notation); IPv4-mapped addresses are unwrapped and
 * re-checked; only `unicast` ranges pass. IPv4-compatible (::/96), 6to4 (2002::/16), NAT64
 * (64:ff9b::/96, which may embed a private v4) and anything outside 2000::/3 are refused.
 */
export function isBlockedAddress(address: string): boolean {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(address.replace(/^\[|\]$/g, '').replace(/%.*$/, ''));
  } catch {
    return true; // not an IP at all: refuse
  }
  if (parsed.kind() === 'ipv6') {
    const v6 = parsed as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) return isBlockedAddress(v6.toIPv4Address().toString());
    if (!v6.match(GLOBAL_V6, 3)) return true; // includes ::/96 (IPv4-compatible), ::1, fc00::/7, fe80::/10, ff00::/8
    if (v6.range() !== 'unicast') return true; // 6to4, teredo, rfc6052 (NAT64), documentation …
    return false;
  }
  return (parsed as ipaddr.IPv4).range() !== 'unicast';
}

function shannon(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Normalised host: lowercase, IDN → punycode (ASCII), no trailing dot. */
export function normalizeHost(host: string): string {
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '');
  if (isIP(h)) return h;
  return domainToASCII(h) || h;
}

/** Registrable domain from the public suffix list (e.g. a.b.co.uk → b.co.uk); IPs map to themselves. */
export function baseDomain(host: string): string {
  const h = normalizeHost(host);
  if (isIP(h)) return h;
  return getDomain(h, { allowPrivateDomains: true }) ?? h;
}

const DOMAIN_TOKEN = /(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+\p{L}[\p{L}\p{N}-]{0,62}\.?/gu;

/** Registrable domains the user explicitly wrote/said (whole tokens only, never substrings). */
export function mentionedDomains(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(DOMAIN_TOKEN)) {
    // A token glued to a preceding letter/digit/hyphen is part of a longer word, not a mention.
    const before = m.index ? text[m.index - 1] : '';
    if (before && /[\p{L}\p{N}-]/u.test(before)) continue;
    const d = getDomain(normalizeHost(m[0]), { allowPrivateDomains: true });
    if (d) out.add(d);
  }
  return out;
}

/** Characters that could carry data out: subdomain labels + path + query. */
export function egressPayload(url: URL): string {
  const host = url.hostname.toLowerCase();
  const base = baseDomain(host);
  const sub = host === base ? '' : host.slice(0, host.length - base.length - 1).replace(/^www\.?/, '');
  const path = url.pathname === '/' ? '' : url.pathname;
  return `${sub}${path}${url.search}`;
}

export function overBudget(url: URL): boolean {
  const payload = egressPayload(url);
  if (payload.length > EGRESS_BUDGET_CHARS) return true;
  return payload
    .split(/[/.?&=_\-+]/)
    .some((seg) => seg.length >= 20 && shannon(seg) > 3.5 && /\d/.test(seg) && /[a-z]/i.test(seg));
}

export interface GuardDecision {
  needsApproval: boolean;
  reasons: string[];
  /** The vetted IP the request must connect to (DNS pinning). */
  address: string;
}

export interface PinnedRequest {
  method: string;
  body?: string;
  signal?: AbortSignal;
}

/** HTTP client that connects to an already-vetted IP (no second DNS lookup, so no rebinding window). */
export type PinnedFetch = (url: URL, init: PinnedRequest, address: string) => Promise<Response>;

export const pinnedFetch: PinnedFetch = (url, init, address) =>
  new Promise((resolve, reject) => {
    // Connect to the IP itself (Bun ignores a custom `lookup`), keeping the original name for the Host
    // header and for TLS SNI + certificate validation (`servername`). Verified under Node and Bun.
    const https = url.protocol === 'https:';
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const options: RequestOptions = {
      hostname: address,
      family: isIP(address) === 6 ? 6 : 4,
      port: url.port ? Number(url.port) : https ? 443 : 80,
      path: `${url.pathname}${url.search}`,
      method: init.method,
      signal: init.signal,
      headers: {
        host: url.host,
        'user-agent': 'JarvisDesktop/0.1 (+home-agent)',
        accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5',
      },
      timeout: 20_000,
    };
    if (https && !isIP(hostname)) (options as { servername?: string }).servername = hostname;
    const req = (https ? httpsRequest : httpRequest)(options, (res: IncomingMessage) => {
      const headers = new Headers();
      for (const [k, v] of Object.entries(res.headers)) {
        if (Array.isArray(v)) for (const x of v) headers.append(k, x);
        else if (v !== undefined) headers.set(k, v);
      }
      const status = res.statusCode ?? 502;
      const nullBody = status === 204 || status === 304 || init.method === 'HEAD';
      if (nullBody) res.resume();
      resolve(
        new Response(nullBody ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>), {
          status: status < 200 || status > 599 ? 502 : status,
          headers,
        }),
      );
    });
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });

export class WebGuard {
  tainted = false;
  readonly approvedHosts = new Set<string>();
  private readonly mentioned: Set<string>;

  constructor(
    userText: string,
    private readonly resolver: Resolver = dnsResolver,
  ) {
    this.mentioned = mentionedDomains(userText);
  }

  taint(): void {
    this.tainted = true;
  }

  /** Throws for forbidden destinations; returns whether approval is required. */
  async check(url: URL, method: string, hasBody: boolean): Promise<GuardDecision> {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('only http(s) URLs are allowed');
    if (url.username || url.password) throw new Error('URLs with credentials are not allowed');
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
      throw new Error('local network addresses are not allowed');
    }
    const addresses = isIP(host) ? [host] : await this.resolver(host);
    if (!addresses.length) throw new Error(`cannot resolve ${host}`);
    // Every resolved address must be public; the connection is then pinned to the first one.
    for (const a of addresses) if (isBlockedAddress(a)) throw new Error('private or local addresses are not allowed');
    const address = addresses[0] as string;

    const reasons: string[] = [];
    const approved = this.approvedHosts.has(host);
    const said = this.mentioned.has(baseDomain(host));
    if (this.tainted && !approved) reasons.push('private data was read in this task');
    if (!said && !approved) reasons.push('the user did not mention this site');
    if (method !== 'GET' || hasBody) reasons.push(`${method} request with data`);
    if (overBudget(url)) reasons.push('the address carries a lot of data');
    return { needsApproval: reasons.length > 0, reasons, address };
  }

  approve(url: URL): void {
    this.approvedHosts.add(url.hostname.toLowerCase());
  }
}

/** Reads at most `max` bytes of a response body as text. */
export async function readCapped(
  res: Response,
  max = MAX_RESPONSE_BYTES,
): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: '', truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > max) {
      chunks.push(value.subarray(0, max - total));
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  return { text: Buffer.concat(chunks).toString('utf8'), truncated };
}
