/**
 * The Jarvis MCP server (transport-agnostic): lists the tools from `@jarvis/core` and forwards calls.
 *
 * It uses the SDK's low-level `Server` on purpose: the tool catalogue (with JSON Schemas generated
 * from core's zod schemas) is shared with the relay, so we hand the exact same definitions to clients.
 */
import { McpTools } from '@jarvis/core';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { errorResult, type Forward } from './forward.js';
import { isToolName, toolDefinitions } from './tools.js';

export const SERVER_NAME = 'jarvis';
export const SERVER_VERSION = '0.1.1';

export const SERVER_INSTRUCTIONS =
  "Jarvis is the user's voice assistant on their computer. Use jarvis_speak for short spoken updates, " +
  'jarvis_ask_user when you are blocked and need a decision, and jarvis_notify for silent notices. ' +
  'Keep spoken text short and natural; never read out code, logs or secrets.';

export interface JarvisServerOptions {
  forward: Forward;
  /** Overrides the client name sent to Jarvis (default: the MCP `clientInfo.name`). */
  clientName?: () => string | undefined;
}

export function createJarvisMcpServer({ forward, clientName }: JarvisServerOptions): Server {
  const server = new Server(
    { name: SERVER_NAME, title: 'Jarvis', version: SERVER_VERSION },
    { capabilities: { tools: { listChanged: false } }, instructions: SERVER_INSTRUCTIONS },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions() }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    if (!isToolName(name)) return errorResult(`Unknown tool: ${name}`);
    const parsed = McpTools[name].params.safeParse(rawArgs ?? {});
    if (!parsed.success) return errorResult(`Invalid arguments for ${name}:\n${z.prettifyError(parsed.error)}`);
    const client = clientName ? clientName() : server.getClientVersion()?.name;
    return forward(name, parsed.data as Record<string, unknown>, client);
  });

  return server;
}
