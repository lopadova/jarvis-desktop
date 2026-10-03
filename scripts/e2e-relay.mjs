#!/usr/bin/env node
/**
 * End-to-end test: real sidecar ⇄ real relay Worker (local `wrangler dev`, no Cloudflare account).
 *  1. starts `wrangler dev` for packages/relay on a free loopback port with a temp state dir;
 *  2. starts the real sidecar (Bun, temp data dir, in-memory secrets, no watchdog);
 *  3. pairs it through the `relay.pair` RPC (role `ui`) and waits for the desktop link to connect;
 *  4. runs the OAuth flow with the pairing code (dynamic client registration + PKCE), like ChatGPT;
 *  5. calls `initialize`, `tools/list` and `tools/call jarvis_list_sessions` on the relay's /mcp and
 *     checks that write tools are hidden by default (listed and callable);
 *  6. unpairs through `relay.unpair` and checks the old OAuth grant is rejected (401) and the pairId
 *     is tombstoned (409).
 * Usage: pnpm e2e:relay   (Node ≥ 22, Bun on PATH)
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const relayDir = join(root, 'packages/relay');
const require = createRequire(join(root, 'packages/agent-host/package.json'));
const WebSocket = require('ws');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
};

const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });

/** Kills a process tree (wrangler starts workerd children). Argument vectors only. */
const killTree = (child) => {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const relayPort = await freePort();
const BASE = `http://127.0.0.1:${relayPort}`;
const relayState = mkdtempSync(join(tmpdir(), 'jarvis-e2e-relay-state-'));
const dataDir = mkdtempSync(join(tmpdir(), 'jarvis-e2e-relay-'));
const launchToken = randomBytes(32).toString('hex');
let wrangler;
let sidecar;
let wranglerLog = '';
let sidecarErr = '';

try {
  // ── 1. relay Worker under wrangler dev
  wrangler = spawn(
    process.execPath,
    [
      join(relayDir, 'node_modules/wrangler/bin/wrangler.js'),
      'dev',
      '--ip',
      '127.0.0.1',
      '--port',
      String(relayPort),
      '--persist-to',
      relayState,
      '--show-interactive-dev-session=false',
      // Short relay-side call timeout so a hung call fails the test quickly.
      '--var',
      'CALL_TIMEOUT_MS:20000',
    ],
    {
      cwd: relayDir,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    },
  );
  wrangler.stdout.on('data', (d) => {
    wranglerLog += d;
  });
  wrangler.stderr.on('data', (d) => {
    wranglerLog += d;
  });
  let healthy = false;
  for (let i = 0; i < 120 && !healthy; i++) {
    if (wrangler.exitCode !== null) break;
    try {
      healthy = (await fetch(`${BASE}/health`)).ok;
    } catch {
      await sleep(500);
    }
  }
  if (!check('wrangler dev serves the relay', healthy, BASE)) throw new Error(`relay not ready\n${wranglerLog}`);

  // ── 2. real sidecar
  sidecar = spawn('bun', ['run', join(root, 'packages/agent-host/src/main.ts')], {
    env: {
      ...process.env,
      JARVIS_LAUNCH_TOKEN: launchToken,
      JARVIS_DEV_SECRETS: 'memory',
      JARVIS_NO_WATCHDOG: '1',
      JARVIS_DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  sidecar.stderr.on('data', (d) => {
    sidecarErr += d;
  });
  const port = await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`sidecar not ready in 30 s\n${sidecarErr}`)), 30_000);
    let buf = '';
    sidecar.stdout.on('data', (d) => {
      buf += d;
      const m = buf.match(/JARVIS_READY (\d+)/);
      if (m) {
        clearTimeout(t);
        res(Number(m[1]));
      }
    });
    sidecar.once('exit', (c) => rej(new Error(`sidecar exited ${c}\n${sidecarErr}`)));
  });
  check('sidecar prints JARVIS_READY', true, `port ${port}`);

  // ── 3. pair through the UI role
  const ui = new WebSocket(`ws://127.0.0.1:${port}/?role=ui`, [`jarvis.${launchToken}`]);
  await new Promise((res, rej) => {
    ui.once('open', res);
    ui.once('error', rej);
  });
  const pending = new Map();
  const relayEvents = [];
  ui.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.id !== undefined && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.rej(new Error(`${msg.error.message} (${msg.error.code})`));
      else p.res(msg.result);
    } else if (msg.method === 'ui.relay') relayEvents.push(msg.params);
  });
  let nextId = 1;
  const rpc = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = nextId++;
      pending.set(id, { res, rej });
      ui.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      setTimeout(() => {
        if (pending.delete(id)) rej(new Error(`${method} timed out`));
      }, 20_000);
    });
  const waitStatus = async (pred, ms = 15_000) => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const s = await rpc('relay.status');
      if (pred(s)) return s;
      await sleep(200);
    }
    return rpc('relay.status');
  };

  const paired = await rpc('relay.pair', { relayUrl: BASE });
  check(
    'relay.pair registers with the relay',
    /^[A-Z2-7]{8}$/.test(paired.code) && /^[a-z2-7]{26}$/.test(paired.pairId),
    `pair ${paired.pairId}, code ${paired.code}`,
  );
  const connected = await waitStatus((s) => s.status === 'connected');
  check(
    'desktop link connects to /desktop/connect',
    connected.status === 'connected',
    JSON.stringify(connected.status),
  );
  await sleep(500); // the hello frame is stored by the Durable Object right after the upgrade

  // ── 4. OAuth with the pairing code (what ChatGPT does when the connector is added)
  const REDIRECT = 'http://127.0.0.1:9/callback';
  let res = await fetch(`${BASE}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'e2e-relay', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }),
  });
  const { client_id: clientId } = await res.json();
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: 'jarvis',
    state: 'e2e',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  res = await fetch(`${BASE}/authorize?${query}`);
  const html = await res.text();
  const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1];
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  res = await fetch(`${BASE}/authorize`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: new URLSearchParams({ handle: handle ?? '', code: paired.code, decision: 'approve' }),
  });
  const authCode = new URL(res.headers.get('location') ?? 'x:/').searchParams.get('code');
  res = await fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: authCode ?? '',
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
    }),
  });
  const { access_token: token } = await res.json();
  if (!check('OAuth flow completes with the pairing code', !!token)) throw new Error('no access token');

  // ── 5. remote MCP through the relay → desktop link → sidecar
  let rpcId = 0;
  const mcp = async (method, params, bearer = token) => {
    const r = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${bearer}`,
        'User-Agent': 'openai-mcp e2e-relay',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    });
    return { status: r.status, body: r.status === 200 ? await r.json() : await r.text() };
  };
  const init = await mcp('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'e2e', version: '0' },
  });
  check('initialize', init.body?.result?.serverInfo?.name === 'jarvis-relay', init.body?.result?.protocolVersion);
  const list = await mcp('tools/list', {});
  const tools = list.body?.result?.tools ?? [];
  const names = tools.map((t) => t.name);
  check(
    'tools/list returns the tools from the desktop hello',
    names.includes('jarvis_list_sessions'),
    names.join(', '),
  );
  check(
    'write tools are hidden by default (every listed tool is read-only)',
    tools.length > 0 &&
      tools.every((t) => t.annotations?.readOnlyHint === true) &&
      !names.includes('jarvis_start_task'),
  );
  const call = await mcp('tools/call', { name: 'jarvis_list_sessions', arguments: {} });
  const text = call.body?.result?.content?.[0]?.text;
  check(
    'tools/call jarvis_list_sessions round-trips to the sidecar',
    call.body?.result && !call.body.result.isError && text === 'No sessions.',
    JSON.stringify(text),
  );
  const hidden = await mcp('tools/call', { name: 'jarvis_start_task', arguments: { task: 'echo hi' } });
  check(
    'a hidden write tool cannot be called',
    !!hidden.body?.error && /Unknown tool/.test(hidden.body.error.message),
    hidden.body?.error?.message,
  );

  // ── 6. unpair → old grant rejected, pairId tombstoned
  const unpaired = await rpc('relay.unpair');
  check('relay.unpair revokes the pairing on the relay', unpaired.remote === 'revoked', JSON.stringify(unpaired));
  const after = await mcp('tools/list', {});
  check('the old OAuth grant is rejected after unpairing', after.status === 401, `HTTP ${after.status}`);
  res = await fetch(`${BASE}/pair/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairId: paired.pairId, secretHash: '0'.repeat(64), label: 'reuse' }),
  });
  check('the unpaired pairId cannot be registered again (tombstone)', res.status === 409, `HTTP ${res.status}`);
  const st = await rpc('relay.status');
  check('the sidecar reports unpaired', st.status === 'unpaired', st.status);
  ui.close();
} catch (e) {
  check('e2e relay run', false, e instanceof Error ? e.message : String(e));
} finally {
  if (sidecar) sidecar.kill();
  killTree(wrangler);
  await sleep(500);
  for (const dir of [dataDir, relayState]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* workerd may still hold files for a moment on Windows */
    }
  }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed && wranglerLog) console.log(`\n--- wrangler output (tail) ---\n${wranglerLog.slice(-3000)}`);
process.exit(failed ? 1 : 0);
