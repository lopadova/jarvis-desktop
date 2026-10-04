/** Debug helper: prints the assistant events of the RUNNING app for N seconds while a person talks to it.
 * Usage: node scripts/e2e-app/trace-events.mjs [seconds] */
import { connect, pageFor, sidecar } from './lib.mjs';

const secs = Number(process.argv[2] ?? 60);
const b = await connect();
const home = await pageFor(b, 'home');
const ep = await home.evaluate(() => window.__TAURI_INTERNALS__.invoke('sidecar_endpoint'));
const { createRequire } = await import('node:module');
const { join } = await import('node:path');
const WebSocket = createRequire(join(process.cwd(), 'packages/mcp/package.json'))('ws');
const ws = new WebSocket(`ws://127.0.0.1:${ep.port}/?role=ui`, [`jarvis.${ep.token}`]);
await new Promise((r) => ws.once('open', r));
const t0 = Date.now();
let maxLevel = 0;
ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));
  const st = m.params?.state;
  if (m.method === 'ui.pill' && st?.kind === 'listening') {
    maxLevel = Math.max(maxLevel, st.level ?? 0);
    if (!st.partial && !st.committed && (st.level ?? 0) < 0.02 && Date.now() - t0 > 0) {
      if (!globalThis.__shownListen) {
        globalThis.__shownListen = true;
        console.log(`+${((Date.now() - t0) / 1000).toFixed(1)}s [pill: listening]`);
      }
      return;
    }
  }
  console.log(`+${((Date.now() - t0) / 1000).toFixed(1)}s ${JSON.stringify(m).slice(0, 210)}`);
});
await new Promise((r) => setTimeout(r, secs * 1000));
console.log('max mic level:', maxLevel.toFixed(3));
ws.close();
await b.close();
void sidecar;
