/**
 * MCP client pool for the Home agent: connects to the user's configured MCP servers
 * (`<dataDir>/mcp.json`, same shape as Claude Desktop: `{ "mcpServers": { name: { command, args, env } | { url } } }`).
 * Tool annotations (`readOnlyHint` / `destructiveHint`) drive the risk classification.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '@jarvis/core';
import { safeChildEnv } from '../child-env.js';
import { errorMessage } from '../util.js';

export interface McpServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface RemoteTool {
  server: string;
  name: string;
  description: string;
  inputSchema: unknown;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpToolSource {
  tools(): Promise<RemoteTool[]>;
  call(server: string, tool: string, args: Record<string, unknown>): Promise<string>;
  close(): Promise<void>;
}

interface ClientLike {
  connect(transport: unknown): Promise<void>;
  listTools(): Promise<{
    tools: {
      name: string;
      description?: string;
      inputSchema: unknown;
      annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean };
    }[];
  }>;
  callTool(p: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
  close(): Promise<void>;
}

export async function loadMcpConfig(dataDir: string): Promise<Record<string, McpServerEntry>> {
  try {
    const raw = JSON.parse(await readFile(join(dataDir, 'mcp.json'), 'utf8')) as {
      mcpServers?: Record<string, McpServerEntry>;
    };
    return raw.mcpServers ?? {};
  } catch {
    return {};
  }
}

export class McpClientPool implements McpToolSource {
  private readonly clients = new Map<string, ClientLike>();
  private cache: RemoteTool[] | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly logger: Logger,
  ) {}

  private async connectAll(): Promise<void> {
    if (this.cache) return;
    const config = await loadMcpConfig(this.dataDir);
    const tools: RemoteTool[] = [];
    for (const [name, entry] of Object.entries(config)) {
      if (name === 'jarvis') continue; // never loop back into ourselves
      try {
        const client = await this.connect(name, entry);
        this.clients.set(name, client);
        const listed = await client.listTools();
        for (const t of listed.tools) {
          tools.push({
            server: name,
            name: t.name,
            description: (t.description ?? '').slice(0, 300),
            inputSchema: t.inputSchema,
            readOnlyHint: t.annotations?.readOnlyHint,
            destructiveHint: t.annotations?.destructiveHint,
            openWorldHint: t.annotations?.openWorldHint,
          });
        }
      } catch (e) {
        this.logger.warn('mcp server unavailable', { server: name, error: errorMessage(e) });
      }
    }
    this.cache = tools;
  }

  private async connect(name: string, entry: McpServerEntry): Promise<ClientLike> {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const client = new Client({ name: 'jarvis-home-agent', version: '0.1.0' }) as unknown as ClientLike;
    if (entry.url) {
      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
      await client.connect(new StreamableHTTPClientTransport(new URL(entry.url)));
    } else if (entry.command) {
      const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
      await client.connect(
        new StdioClientTransport({
          command: entry.command,
          args: entry.args ?? [],
          env: safeChildEnv(entry.env ?? {}),
          stderr: 'ignore',
        }),
      );
    } else throw new Error(`server ${name} has neither command nor url`);
    return client;
  }

  async tools(): Promise<RemoteTool[]> {
    await this.connectAll();
    return this.cache ?? [];
  }

  async call(server: string, tool: string, args: Record<string, unknown>): Promise<string> {
    const c = this.clients.get(server);
    if (!c) throw new Error(`unknown MCP server ${server}`);
    const res = (await c.callTool({ name: tool, arguments: args })) as {
      content?: { type: string; text?: string }[];
      isError?: boolean;
    };
    const text = (res.content ?? []).map((b) => (b.type === 'text' ? (b.text ?? '') : `[${b.type}]`)).join('\n');
    return res.isError ? `ERROR: ${text}` : text;
  }

  async close(): Promise<void> {
    for (const c of this.clients.values()) await c.close().catch(() => undefined);
    this.clients.clear();
    this.cache = null;
  }
}
