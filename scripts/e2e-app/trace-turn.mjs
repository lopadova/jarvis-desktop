/** Debug helper: submits a turn to the RUNNING app's assistant and prints every event for N seconds.
 * Usage: node scripts/e2e-app/trace-turn.mjs "text" [seconds] */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { connect, pageFor } from './lib.mjs';

const WebSocket = createRequire(join(process.cwd(), 'packages/mcp/package.json'))('ws');
const text = process.argv[2] ?? 'What is the capital of Italy?';
const secs = Number(process.argv[3] ?? 40);
const b = await connect();
const home = await pageFor(b, 'home');
const ep = await home.evaluate(() => window.__TAURI_INTERNALS__.invoke('sidecar_endpoint'));
const ws = new WebSocket(`ws://127.0.0.1:${ep.port}/?role=ui`, [`jarvis.${ep.token}`]);
await new Promise((r) => ws.once('open', r));
const t0 = Date.now();
ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));
  const s = JSON.stringify(m).slice(0, 260);
  if (!/ui\.level|ui\.partial/.test(s)) console.log(`+${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`);
});
if (process.env.PRIMARY)
  ws.send(
    JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'providers.setPrimary', params: { brain: process.env.PRIMARY } }),
  );
ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'turn.submit', params: { text, source: 'text' } }));
await new Promise((r) => setTimeout(r, secs * 1000));
ws.close();
await b.close();
