/**
 * Stage 5 — MCP with a real Claude: `claude -p` is given a TEMPORARY MCP config (your global config is untouched)
 * pointing at the Jarvis bridge, and asked to remember a fact through `jarvis_remember`. We then check that the fact
 * really arrived in the assistant process's memory.
 * Usage: node scripts/e2e-app/05-mcp.mjs   (build the bridge first: pnpm --filter @jarvis/mcp build)
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const WebSocket = createRequire(join(root, 'packages/mcp/package.json'))('ws');
const bridge = join(root, 'packages/mcp/dist/jarvis-mcp.mjs');
const token = randomBytes(32).toString('hex');
const dataDir = mkdtempSync(join(tmpdir(), 'jarvis-e2e-mcp-'));
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${String(detail).slice(0, 260)}` : ''}`);
};
check('MCP bridge is built', existsSync(bridge), bridge);

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
const port = await new Promise((res, rej) => {
  let buf = '';
  setTimeout(() => rej(new Error('sidecar not ready')), 30000);
  sidecar.stdout.on('data', (d) => {
    buf += d;
    const m = buf.match(/JARVIS_READY (\d+)/);
    if (m) res(Number(m[1]));
  });
});

const config = join(dataDir, 'mcp.json');
writeFileSync(
  config,
  JSON.stringify({
    mcpServers: { jarvis: { command: process.execPath, args: [bridge], env: { JARVIS_DATA_DIR: dataDir } } },
  }),
);
const secret = `e2e-${randomBytes(3).toString('hex')}`;

// Play the user: open the UI connection first and click "Allow" when Jarvis asks to save the memory.
const ws = new WebSocket(`ws://127.0.0.1:${port}/?role=ui`, [`jarvis.${token}`]);
await new Promise((r) => ws.once('open', r));
const waiting = new Map();
let nextId = 0;
let approved = 0;
const call = (method, params) =>
  new Promise((res) => {
    const id = ++nextId;
    waiting.set(id, res);
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });
ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.id && waiting.has(msg.id)) {
    waiting.get(msg.id)(msg);
    waiting.delete(msg.id);
  } else if (msg.method === 'ui.approval' && msg.params?.state === 'pending') {
    approved++;
    void call('approval.decide', { id: msg.params.request.id, decision: 'allow-once', via: 'click' });
  }
});

const prompt = `Use the jarvis_remember tool to remember exactly this fact: "my e2e code word is ${secret}". Then reply with the single word: stored.`;
const claude = spawn(
  'claude',
  ['-p', prompt, '--mcp-config', config, '--strict-mcp-config', '--allowedTools', 'mcp__jarvis__jarvis_remember'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let out = '';
claude.stdout.on('data', (d) => {
  out += d;
});
const code = await new Promise((res) => {
  const t = setTimeout(() => {
    claude.kill();
    res(-1);
  }, 240000);
  claude.on('exit', (c) => {
    clearTimeout(t);
    res(c);
  });
});
check('claude -p finished', code === 0, out.trim());
check('Jarvis asked the user before saving the memory (R: external writes are gated)', approved >= 1);
const list = (await call('memory.list', {})).result;
const found = JSON.stringify(list ?? {}).includes(secret);
check('the fact written by Claude through MCP is in Jarvis memory', found, JSON.stringify(list));

ws.close();
sidecar.kill();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
