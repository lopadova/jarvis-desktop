/**
 * Minimal, stateless MCP Streamable HTTP endpoint (JSON responses only) shared by both relays.
 *
 * Handles: initialize, notifications/initialized (and any other notification), ping, tools/list,
 * tools/call. The tool list is the intersection of the desktop's last `hello` and the catalogue
 * generated from @jarvis/core, so annotations always come from core while the desktop decides which
 * tools are exposed.
 */
import { type CatalogTool, TOOL_CATALOG } from './catalog.generated.js';
import { byteLength, LIMITS } from './pairing.js';

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const RELAY_VERSION = '0.1.0';

export interface ToolResult {
  content: unknown[];
  isError?: boolean;
}

export interface RelayBackend {
  /** Tool names from the desktop's last `hello`. */
  exposedTools(): Promise<string[]>;
  callTool(name: string, args: Record<string, unknown>, client: string): Promise<ToolResult>;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const INSTRUCTIONS =
  "Jarvis is the user's voice assistant on their own computer, reached through this relay. Use jarvis_speak for " +
  'short spoken updates and jarvis_ask_user when you need a decision. Every call is shown to the user and risky ' +
  'actions still need their approval on screen.';

export const OFFLINE_TEXT = 'Jarvis is offline on your computer';

export function textResult(text: string, isError = false): ToolResult {
  return isError ? { content: [{ type: 'text', text }], isError: true } : { content: [{ type: 'text', text }] };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

function rpcError(id: JsonRpcRequest['id'], code: number, message: string, status = 200): Response {
  return json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, status);
}

/** A short client label for the desktop UI ("chatgpt" for OpenAI's connector). */
export function clientLabel(userAgent: string | null): string {
  const ua = userAgent ?? '';
  if (/openai|chatgpt/i.test(ua)) return 'chatgpt';
  return ua.replace(/[^\w ./-]/g, '').slice(0, 60) || 'remote';
}

export function listedTools(exposed: string[]): CatalogTool[] {
  const names = new Set(exposed);
  return TOOL_CATALOG.filter((tool) => names.has(tool.name));
}

/** Handles one HTTP request to `/mcp`. Authentication happens before this is called. */
export async function handleMcpRequest(request: Request, backend: RelayBackend): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Use POST (this endpoint does not open SSE streams)' }, 405, { Allow: 'POST' });
  }
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > LIMITS.maxMcpBodyBytes) return rpcError(null, -32600, 'Request too large', 413);
  const raw = await request.text();
  if (byteLength(raw) > LIMITS.maxMcpBodyBytes) return rpcError(null, -32600, 'Request too large', 413);

  let message: JsonRpcRequest;
  try {
    message = JSON.parse(raw) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, 'Parse error', 400);
  }
  if (Array.isArray(message)) return rpcError(null, -32600, 'Batch requests are not supported', 400);
  if (!message || message.jsonrpc !== '2.0') return rpcError(null, -32600, 'Invalid JSON-RPC message', 400);

  // Notifications and client responses get 202 with no body.
  if (message.id === undefined || message.id === null || typeof message.method !== 'string') {
    return new Response(null, { status: 202 });
  }
  const { id, method } = message;
  const params = message.params ?? {};

  switch (method) {
    case 'initialize': {
      const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      const protocolVersion = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
        ? requested
        : SUPPORTED_PROTOCOL_VERSIONS[0];
      return json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'jarvis-relay', title: 'Jarvis', version: RELAY_VERSION },
          instructions: INSTRUCTIONS,
        },
      });
    }
    case 'ping':
      return json({ jsonrpc: '2.0', id, result: {} });
    case 'tools/list':
      return json({ jsonrpc: '2.0', id, result: { tools: listedTools(await backend.exposedTools()) } });
    case 'tools/call': {
      const name = params.name;
      const args = params.arguments ?? {};
      if (typeof name !== 'string') return rpcError(id, -32602, 'Missing tool name');
      if (typeof args !== 'object' || Array.isArray(args)) return rpcError(id, -32602, 'arguments must be an object');
      if (!listedTools(await backend.exposedTools()).some((tool) => tool.name === name)) {
        return rpcError(id, -32602, `Unknown tool: ${name}`);
      }
      if (byteLength(JSON.stringify(args)) > LIMITS.maxFrameBytes) {
        return json({ jsonrpc: '2.0', id, result: textResult('Arguments are larger than 64 KB', true) });
      }
      const result = await backend.callTool(
        name,
        args as Record<string, unknown>,
        clientLabel(request.headers.get('user-agent')),
      );
      return json({ jsonrpc: '2.0', id, result });
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}
