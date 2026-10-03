#!/usr/bin/env node
/**
 * End-to-end smoke test across packages (no GUI, no network):
 *  1. starts the real sidecar (packages/agent-host) under Bun with a temp data dir and in-memory secrets;
 *  2. connects as role `ui` with the launch token and submits a fast-path turn ("what time is it");
 *  3. launches the real bundled MCP bridge (packages/mcp/dist/jarvis-mcp.mjs) over stdio with the MCP SDK client,
 *     lists tools and calls read-only tools through the sidecar.
 * Usage: node scripts/e2e-smoke.mjs   (build the bridge first: pnpm --filter @jarvis/mcp build)
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, 'packages/mcp/package.json'));
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const WebSocket = require('ws');

const dataDir = mkdtempSync(join(tmpdir(), 'jarvis-e2e-'));
const token = randomBytes(32).toString('hex');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const sidecar = spawn('bun', ['run', join(root, 'packages/agent-host/src/main.ts')], {
  env: {
    ...process.env,
    JARVIS_LAUNCH_TOKEN: token,
    JARVIS_DEV_SECRETS: 'memory',
    JARVIS_NO_WATCHDOG: '1',
    JARVIS_DATA_DIR: dataDir,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
sidecar.stderr.on('data', (d) => {
  stderr += d;
});

try {
  const port = await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`sidecar not ready in 30 s\n${stderr}`)), 30_000);
    let buf = '';
    sidecar.stdout.on('data', (d) => {
      buf += d;
      const m = buf.match(/JARVIS_READY (\d+)/);
      if (m) {
        clearTimeout(t);
        res(Number(m[1]));
      }
    });
    sidecar.once('exit', (c) => rej(new Error(`sidecar exited ${c}\n${stderr}`)));
  });
  check('sidecar prints JARVIS_READY', true, `port ${port}`);

  // ── wrong token is rejected
  const rejected = await new Promise((res) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?role=ui`, ['jarvis.wrong']);
    ws.once('open', () => {
      ws.close();
      res(false);
    });
    ws.once('error', () => res(true));
    ws.once('unexpected-response', () => res(true));
  });
  check('wrong launch token is rejected', rejected);

  // ── ui role: fast-path turn
  const reply = await new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?role=ui`, [`jarvis.${token}`]);
    const t = setTimeout(() => rej(new Error('no ui.chat reply in 10 s')), 10_000);
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.method === 'ui.chat') {
        const items = Array.isArray(msg.params) ? msg.params : [msg.params?.message ?? msg.params];
        const jarvis = items.flat().find((m) => m?.role === 'jarvis');
        if (jarvis) {
          clearTimeout(t);
          ws.close();
          res(jarvis.text);
        }
      }
    });
    ws.once('open', () =>
      ws.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'turn.submit',
          params: { text: 'what time is it', source: 'text' },
        }),
      ),
    );
    ws.once('error', rej);
  });
  check('fast-path turn answered without a brain', /\d{1,2}[:.]\d{2}/.test(reply), JSON.stringify(reply));

  // ── MCP bridge over stdio through the real sidecar
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, 'packages/mcp/dist/jarvis-mcp.mjs')],
    env: { ...process.env, JARVIS_DATA_DIR: dataDir },
  });
  const client = new Client({ name: 'e2e-smoke', version: '0.0.0' });
  await client.connect(transport);
  const { tools } = await client.listTools();
  check('MCP bridge lists all Jarvis tools', tools.length === 8, tools.map((t) => t.name).join(', '));
  const sessions = await client.callTool({ name: 'jarvis_list_sessions', arguments: {} });
  check(
    'jarvis_list_sessions round-trips through the sidecar',
    !sessions.isError,
    JSON.stringify(sessions.content).slice(0, 120),
  );
  const recall = await client.callTool({ name: 'jarvis_recall', arguments: {} });
  check('jarvis_recall round-trips through the sidecar', !recall.isError, JSON.stringify(recall.content).slice(0, 120));
  await client.close();
} catch (e) {
  check('smoke run', false, e instanceof Error ? e.message : String(e));
} finally {
  sidecar.kill();
  setTimeout(() => rmSync(dataDir, { recursive: true, force: true }), 500);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exitCode = failed ? 1 : 0;
