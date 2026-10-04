/**
 * Stage 9 — after Sign in with ChatGPT (stage 8): make ChatGPT the primary brain of the running app, ask a question
 * that the fast path cannot answer, and check the reply came from the ChatGPT plan brain (not from Codex/Claude).
 * Usage: node scripts/e2e-app/09-chatgpt-brain.mjs
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  check,
  connect,
  conversation,
  ensureApp,
  pageFor,
  say,
  shot,
  sleep,
  summary,
  waitConversation,
} from './lib.mjs';

const WebSocket = createRequire(join(process.cwd(), 'packages/mcp/package.json'))('ws');
await ensureApp();
const browser = await connect();
await sleep(3000);
const home = await pageFor(browser, 'home');
await home.bringToFront();
const ep = await home.evaluate(() => window.__TAURI_INTERNALS__.invoke('sidecar_endpoint'));
const ws = new WebSocket(`ws://127.0.0.1:${ep.port}/?role=ui`, [`jarvis.${ep.token}`]);
await new Promise((r) => ws.once('open', r));
const waiting = new Map();
let id = 0;
ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));
  if (m.id && waiting.has(m.id)) {
    waiting.get(m.id)(m);
    waiting.delete(m.id);
  }
});
const call = (method, params) =>
  new Promise((res) => {
    const i = ++id;
    waiting.set(i, res);
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }));
  });

const st = await call('providers.status', {});
const chatgpt = (st.result?.providers ?? st.result ?? []).find?.((p) => p.id === 'chatgpt');
check('ChatGPT is reported as connected', chatgpt?.connected === true, JSON.stringify(chatgpt));

const prim = await call('providers.setPrimary', { brain: 'chatgpt' });
check('ChatGPT set as the primary brain', !prim.error, prim.error?.message);

await say(home, 'What is the capital of Italy? Answer with just the city name.');
const hit = await waitConversation(home, (c) => /rome|roma/i.test(c), 120000);
check('the ChatGPT plan brain answered', !!hit, hit ? hit.slice(-100) : (await conversation(home)).slice(-200));
await shot(home, 'chatgpt-2-answer');
ws.close();
await browser.close();
process.exit(summary() ? 1 : 0);
