/**
 * `jarvis-mcp` command.
 *
 *   jarvis-mcp                       stdio MCP server (what MCP clients launch)
 *   jarvis-mcp --http [--port 8765] [--allow-origin https://x]
 *                                    Streamable HTTP on 127.0.0.1, bearer token from JARVIS_MCP_HTTP_TOKEN
 *   jarvis-mcp --version | --help
 */
import { parseArgs } from 'node:util';
import { createSidecarForwarder } from './forward.js';
import { createHttpMcpServer } from './http.js';
import { SERVER_VERSION } from './server.js';
import { fileConnectionSource, SidecarClient } from './sidecar.js';
import { runStdio } from './stdio.js';

const HELP = `jarvis-mcp ${SERVER_VERSION} — MCP server for Jarvis Desktop

Usage:
  jarvis-mcp                         Run over stdio (default; used by Claude, Codex, …)
  jarvis-mcp --http [--port <n>]     Run Streamable HTTP on http://127.0.0.1:<n>/mcp (default 8765)
            [--allow-origin <url>]   Allow a browser Origin (repeatable)
            [--path-token]           Also accept the token as /mcp/<token> (for clients that
                                     can't send headers, e.g. ChatGPT through a tunnel)

Environment:
  JARVIS_MCP_HTTP_TOKEN   bearer token required by --http (at least 32 characters)
  JARVIS_DATA_DIR         override the Jarvis data directory
`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      http: { type: 'boolean', default: false },
      port: { type: 'string', default: '8765' },
      'allow-origin': { type: 'string', multiple: true, default: [] },
      'path-token': { type: 'boolean', default: false },
      version: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  });
  if (values.help) return void process.stdout.write(HELP);
  if (values.version) return void process.stdout.write(`${SERVER_VERSION}\n`);
  if (!values.http) return runStdio();

  const token = process.env.JARVIS_MCP_HTTP_TOKEN ?? '';
  if (token.length < 32) {
    process.stderr.write('jarvis-mcp: set JARVIS_MCP_HTTP_TOKEN to a random secret of at least 32 characters.\n');
    process.exit(2);
  }
  const sidecar = new SidecarClient(fileConnectionSource());
  const http = await createHttpMcpServer({
    port: Number(values.port),
    bearerToken: token,
    forward: createSidecarForwarder(sidecar, 'http'),
    allowedOrigins: values['allow-origin'],
    allowPathToken: values['path-token'],
  });
  process.stderr.write(`jarvis-mcp: listening on ${http.url}\n`);
  const stop = () => void http.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error: unknown) => {
  process.stderr.write(`jarvis-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
