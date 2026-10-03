/**
 * Forwarding of MCP tool calls to the sidecar (`mcp.call`), with friendly error results.
 *
 * Errors are returned as MCP tool results with `isError: true` (not protocol errors) so the
 * calling model sees a readable explanation and can tell the user what to do.
 */
import type { McpToolName } from '@jarvis/core';
import { JarvisOfflineError, JarvisRpcError, JarvisTimeoutError, type SidecarClient } from './sidecar.js';
import { toolTimeoutMs } from './tools.js';

export interface TextContent {
  type: 'text';
  text: string;
}

/** Subset of MCP `CallToolResult` that Jarvis produces. */
export interface ToolResult {
  content: Array<TextContent | { type: string; [key: string]: unknown }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  [key: string]: unknown;
}

export type CallOrigin = 'stdio' | 'http' | 'relay';

/** Calls one Jarvis tool. `args` were already validated against the tool's zod schema. */
export type Forward = (tool: McpToolName, args: Record<string, unknown>, client?: string) => Promise<ToolResult>;

export const OFFLINE_MESSAGE = "Jarvis isn't running on this computer — open the Jarvis app and try again.";

export function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/** Accepts whatever the sidecar returned and makes it a valid `CallToolResult`. */
export function normalizeResult(result: unknown): ToolResult {
  if (result && typeof result === 'object' && Array.isArray((result as ToolResult).content)) {
    return result as ToolResult;
  }
  const text = typeof result === 'string' ? result : JSON.stringify(result ?? null);
  return { content: [{ type: 'text', text }] };
}

export function describeError(error: unknown): ToolResult {
  if (error instanceof JarvisOfflineError) return errorResult(OFFLINE_MESSAGE);
  if (error instanceof JarvisTimeoutError) {
    return errorResult(`${error.message}. The user may be away; try again later.`);
  }
  if (error instanceof JarvisRpcError) return errorResult(`Jarvis refused the call: ${error.message}`);
  return errorResult(`Jarvis could not run the tool: ${error instanceof Error ? error.message : String(error)}`);
}

/** A `Forward` that calls `mcp.call` on the sidecar over its loopback WebSocket. */
export function createSidecarForwarder(client: SidecarClient, origin: CallOrigin): Forward {
  return async (tool, args, clientName) => {
    try {
      const params: Record<string, unknown> = { tool, args, origin };
      if (clientName) params.client = clientName.slice(0, 120);
      return normalizeResult(await client.request('mcp.call', params, toolTimeoutMs(tool)));
    } catch (error) {
      return describeError(error);
    }
  };
}
