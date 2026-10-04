/**
 * Stage 4 — a real coding agent (Claude Code) started by voice-style text: "in the demo project create a file".
 * Checks the whole chain: router → session → real agent → file on disk → session done, in `safe` permission mode.
 * A temp project folder and temp data dir are used; nothing of the user's own setup is touched.
 * Usage: node scripts/e2e-app/04-agent.mjs [claude|codex]
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const WebSocket = createRequire(join(root, 'packages/mcp/package.json'))('ws');
const agent = process.argv[2] ?? 'claude';
const token = randomBytes(32).toString('hex');
const dataDir = mkdtempSync(join(tmpdir(), 'jarvis-e2e-agent-'));
const projectDir = mkdtempSync(join(tmpdir(), 'jarvis-e2e-project-'));
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${String(detail).slice(0, 260)}` : ''}`);
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
const port = await new Promise((res, rej) => {
  let buf = '';
  setTimeout(() => rej(new Error('sidecar not ready')), 30000);
  sidecar.stdout.on('data', (d) => {
    buf += d;
    const m = buf.match(/JARVIS_READY (\d+)/);
    if (m) res(Number(m[1]));
  });
});

const ws = new WebSocket(`ws://127.0.0.1:${port}/?role=ui`, [`jarvis.${token}`]);
await new Promise((r) => ws.once('open', r));
const events = [];
const seen = [];
const waiting = new Map();
let id = 0;
ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.id && waiting.has(msg.id)) {
    waiting.get(msg.id)(msg);
    waiting.delete(msg.id);
    return;
  }
  if (msg.method) {
    events.push({ method: msg.method, params: msg.params });
    if (!/pill|level|partial/i.test(msg.method)) seen.push({ method: msg.method, params: msg.params });
  }
});
const call = (method, params) =>
  new Promise((res) => {
    const i = ++id;
    waiting.set(i, res);
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }));
  });
const until = async (pred, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const hit = await pred();
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
};

const p = await call('projects.upsert', {
  project: { name: 'demo', path: projectDir, aliases: [], defaultAgent: agent, permission: 'safe', allowlist: [] },
});
check('project registered (safe permission)', !p.error, p.error?.message);
await call('settings.update', { patch: { primaryBrain: 'claude' } });

call('turn.submit', {
  text: 'In the demo project, create a file called hello.txt containing the single word jarvis',
  source: 'text',
});
const started = await until(() => events.find((e) => /session/i.test(e.method)), 120000);
check('a real agent session was started', !!started, started?.method);

const file = join(projectDir, 'hello.txt');
let approvals = 0;
const done = await until(async () => {
  for (const e of events.splice(0)) {
    // A risky action (a shell command in `safe` mode) asks for approval; answer it like a user clicking "Allow".
    if (e.method === 'ui.approval' && e.params?.state === 'pending') {
      approvals++;
      const r = await call('approval.decide', { id: e.params.request.id, decision: 'allow-once', via: 'click' });
      check('approval was requested and a click granted it', r.result?.ok === true, e.params.request.command ?? '');
    }
  }
  return existsSync(file);
}, 300000);
check('the agent created hello.txt', !!done, `approvals handled: ${approvals}`);
if (!done) console.log(`  last events: ${JSON.stringify(seen.slice(-6)).slice(0, 2500)}`);
if (done) {
  const text = readFileSync(file, 'utf8').trim();
  check('file content is correct', /jarvis/i.test(text), JSON.stringify(text));
}

ws.close();
sidecar.kill();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
