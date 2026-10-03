/**
 * Stage 3 — real brains, no GUI: starts the real assistant process (Bun) with a temp data dir, selects the brain
 * through settings, sends a turn that cannot be answered by the fast path and checks the reply.
 * Uses the user's already logged-in `claude` / `codex` CLIs. Nothing is written to the user's own Jarvis data.
 * Usage: node scripts/e2e-app/03-brains.mjs [claude] [codex]
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const WebSocket = createRequire(join(root, 'packages/mcp/package.json'))('ws');
const brains = process.argv.slice(2).length ? process.argv.slice(2) : ['claude', 'codex'];
const token = randomBytes(32).toString('hex');
const dataDir = mkdtempSync(join(tmpdir(), 'jarvis-e2e-brains-'));
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${String(detail).slice(0, 220)}` : ''}`);
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
let err = '';
sidecar.stderr.on('data', (d) => {
  err += d;
});
const port = await new Promise((res, rej) => {
  let buf = '';
  setTimeout(() => rej(new Error(`not ready\n${err}`)), 30000);
  sidecar.stdout.on('data', (d) => {
    buf += d;
    const m = buf.match(/JARVIS_READY (\d+)/);
    if (m) res(Number(m[1]));
  });
});

const ws = new WebSocket(`ws://127.0.0.1:${port}/?role=ui`, [`jarvis.${token}`]);
await new Promise((r) => ws.once('open', r));
const replies = [];
const waiting = new Map();
let id = 0;
ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.id && waiting.has(msg.id)) {
    waiting.get(msg.id)(msg);
    waiting.delete(msg.id);
  }
  if (msg.method === 'ui.chat') {
    const items = Array.isArray(msg.params) ? msg.params : [msg.params?.message ?? msg.params];
    for (const m of items.flat()) if (m?.role === 'jarvis') replies.push(m.text);
  }
});
const call = (method, params) =>
  new Promise((res) => {
    const i = ++id;
    waiting.set(i, res);
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }));
  });
const waitReply = async (re, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const hit = replies.find((t) => re.test(t));
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
};

for (const brain of brains) {
  replies.length = 0;
  const up = await call('settings.update', { patch: { primaryBrain: brain } });
  check(`${brain}: brain selected`, !up.error, up.error?.message);
  await call('turn.submit', { text: 'What is the capital of France? Answer with just the city name.', source: 'text' });
  const hit = await waitReply(/paris/i, 240000);
  check(`${brain}: real model answered`, !!hit, hit ?? `replies: ${JSON.stringify(replies)}`);
  if (!hit) console.log(`  sidecar stderr (tail): ${err.slice(-1500)}`);
}

ws.close();
sidecar.kill();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
