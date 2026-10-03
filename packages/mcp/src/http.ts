/**
 * Streamable HTTP MCP endpoint on loopback, for local HTTP clients and the "Cloudflare Tunnel" option.
 *
 * Security:
 *  - binds to 127.0.0.1 by default (never 0.0.0.0);
 *  - every request needs `Authorization: Bearer <token>` (compared in constant time);
 *  - a request carrying an `Origin` header is rejected unless that origin is allow-listed
 *    (browsers always send it, server-side MCP clients do not) — this blocks DNS-rebinding and
 *    drive-by requests from web pages;
 *  - stateless: one MCP server per request, JSON responses, no sessions, 1 MiB body cap.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Forward } from './forward.js';
import { createJarvisMcpServer } from './server.js';

export interface HttpMcpServerOptions {
  /** TCP port; `0` picks a free one. */
  port: number;
  /** Interface to bind. Default `127.0.0.1`. */
  host?: string;
  /** Required bearer token (at least 32 characters). */
  bearerToken: string;
  /** Calls `mcp.call` with `origin: 'http'`. */
  forward: Forward;
  /** Browser origins allowed to call the endpoint (exact match, e.g. `https://example.com`). Default none. */
  allowedOrigins?: string[];
  /** URL path of the endpoint. Default `/mcp`. */
  path?: string;
}

export interface HttpMcpServer {
  server: HttpServer;
  port: number;
  url: string;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 1024 * 1024;

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();

export function bearerMatches(header: string | undefined, expectedDigest: Buffer): boolean {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  if (!match?.[1]) return false;
  return timingSafeEqual(digest(match[1]), expectedDigest);
}

function reject(res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message } }));
}

export async function createHttpMcpServer(options: HttpMcpServerOptions): Promise<HttpMcpServer> {
  if (options.bearerToken.length < 32) throw new Error('bearerToken must be at least 32 characters');
  const expected = digest(options.bearerToken);
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  const path = options.path ?? '/mcp';
  const host = options.host ?? '127.0.0.1';

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== path) return reject(res, 404, 'Not found');

    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins.has(origin)) return reject(res, 403, 'Origin not allowed');

    if (!bearerMatches(req.headers.authorization, expected)) {
      return reject(res, 401, 'Unauthorized', { 'WWW-Authenticate': 'Bearer realm="jarvis"' });
    }

    if (req.method !== 'POST') return reject(res, 405, 'Method not allowed', { Allow: 'POST' });

    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_BODY_BYTES) return reject(res, 413, 'Request too large');

    const userAgent = req.headers['user-agent']?.slice(0, 120);
    const server = createJarvisMcpServer({ forward: options.forward, clientName: () => userAgent });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) reject(res, 500, error instanceof Error ? error.message : 'Internal error');
      else res.end();
    });
  });

  await new Promise<void>((resolve, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(options.port, host, () => {
      server.off('error', rejectListen);
      resolve();
    });
  });
  const port = (server.address() as AddressInfo).port;

  return {
    server,
    port,
    url: `http://${host}:${port}${path}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
