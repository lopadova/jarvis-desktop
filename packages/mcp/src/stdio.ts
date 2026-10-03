/**
 * stdio entry point: the process Claude Desktop, Claude Code, Codex … launch as `jarvis-mcp`.
 * stdout carries the MCP protocol, so every diagnostic goes to stderr.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSidecarForwarder } from './forward.js';
import { createJarvisMcpServer } from './server.js';
import { type ConnectionSource, envConnectionSource, fileConnectionSource, SidecarClient } from './sidecar.js';

export interface StdioOptions {
  connection?: ConnectionSource;
}

export async function runStdio(options: StdioOptions = {}): Promise<void> {
  const sidecar = new SidecarClient(options.connection ?? envConnectionSource() ?? fileConnectionSource());
  const server = createJarvisMcpServer({ forward: createSidecarForwarder(sidecar, 'stdio') });
  const transport = new StdioServerTransport();

  const shutdown = async () => {
    sidecar.close();
    await server.close().catch(() => undefined);
    process.exit(0);
  };
  process.stdin.on('end', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.connect(transport);
  process.stderr.write('jarvis-mcp: ready (stdio)\n');
}
