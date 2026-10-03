import { readFile } from 'node:fs/promises';
import { McpTools } from '@jarvis/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createJarvisMcpServer, type Forward, toolDefinitions, toolTimeoutMs } from '../src/index.js';

async function connect(forward: Forward) {
  const server = createJarvisMcpServer({ forward });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, server };
}

describe('tool catalogue', () => {
  it('lists exactly the tools from McpTools with matching annotations and JSON Schema', async () => {
    const { client } = await connect(async () => ({ content: [] }));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(Object.keys(McpTools).sort());

    for (const tool of tools) {
      const spec = McpTools[tool.name as keyof typeof McpTools];
      expect(tool.description).toBe(spec.description);
      expect(tool.annotations?.readOnlyHint).toBe(spec.readOnly);
      expect(tool.annotations?.destructiveHint).toBe(spec.destructive);
      expect(tool.annotations?.openWorldHint).toBe(false);
      expect(tool.annotations?.title).toBeTruthy();
      expect(tool.title).toBe(tool.annotations?.title);

      const { $schema: _s, ...expected } = z.toJSONSchema(spec.params, { io: 'input' }) as Record<string, unknown>;
      expect(tool.inputSchema).toEqual({ ...expected, type: 'object' });
    }
  });

  it('keeps defaulted fields optional in the input schema', () => {
    const ask = toolDefinitions().find((t) => t.name === 'jarvis_ask_user');
    expect(ask?.inputSchema.required).toEqual(['question']);
    expect((ask?.inputSchema.properties as Record<string, { maximum?: number }>).timeoutSeconds?.maximum).toBe(600);
  });

  it('allows 600 s for jarvis_ask_user and 30 s for everything else', () => {
    expect(toolTimeoutMs('jarvis_ask_user')).toBe(600_000);
    expect(toolTimeoutMs('jarvis_speak')).toBe(30_000);
  });
});

describe('tools/call', () => {
  it('validates arguments, applies defaults and passes the MCP client name', async () => {
    const seen: unknown[] = [];
    const { client } = await connect(async (tool, args, clientName) => {
      seen.push({ tool, args, clientName });
      return { content: [{ type: 'text', text: 'done' }] };
    });
    const result = await client.callTool({ name: 'jarvis_notify', arguments: { title: 'Build finished' } });
    expect(result.content).toEqual([{ type: 'text', text: 'done' }]);
    expect(seen).toEqual([
      { tool: 'jarvis_notify', args: { title: 'Build finished', body: '' }, clientName: 'test-client' },
    ]);
  });

  it('returns an error result for invalid arguments without forwarding', async () => {
    let forwarded = false;
    const { client } = await connect(async () => {
      forwarded = true;
      return { content: [] };
    });
    const result = await client.callTool({ name: 'jarvis_speak', arguments: { text: 'x'.repeat(301) } });
    expect(result.isError).toBe(true);
    expect(forwarded).toBe(false);
  });

  it('returns an error result for unknown tools', async () => {
    const { client } = await connect(async () => ({ content: [] }));
    const result = await client.callTool({ name: 'rm_rf', arguments: {} });
    expect(result.isError).toBe(true);
  });
});

describe('integration manifests', () => {
  it('lists the same tools and descriptions in the Claude Desktop extension manifest', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../integrations/claude-desktop/manifest.json', import.meta.url), 'utf8'),
    ) as { tools: Array<{ name: string; description: string }>; server: { entry_point: string } };
    expect(manifest.tools).toEqual(
      Object.entries(McpTools).map(([name, tool]) => ({ name, description: tool.description })),
    );
    expect(manifest.server.entry_point).toBe('server/jarvis-mcp.mjs');
  });
});
