/** Debug helper: hold push-to-talk while the PC speaks, and print the voice events seen by the assistant process.
 * Usage: node scripts/e2e-app/trace-voice.mjs ["sentence"] */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { connect, pageFor, sleep } from './lib.mjs';

const WebSocket = createRequire(join(process.cwd(), 'packages/mcp/package.json'))('ws');
const sentence = process.argv[2] ?? 'what time is it';
const b = await connect();
const home = await pageFor(b, 'home');
const ep = await home.evaluate(() => window.__TAURI_INTERNALS__.invoke('sidecar_endpoint'));
const ws = new WebSocket(`ws://127.0.0.1:${ep.port}/?role=ui`, [`jarvis.${ep.token}`]);
await new Promise((r) => ws.once('open', r));
const t0 = Date.now();
let maxLevel = 0;
ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));
  const level = m.params?.state?.level ?? 0;
  if (m.method === 'ui.pill' && m.params?.state?.kind === 'listening') {
    maxLevel = Math.max(maxLevel, level);
    return;
  }
  console.log(`+${((Date.now() - t0) / 1000).toFixed(1)}s ${JSON.stringify(m).slice(0, 220)}`);
});
const invoke = (c, a) => home.evaluate(([x, y]) => window.__TAURI_INTERNALS__.invoke(x, y), [c, a ?? {}]);
await invoke('push_to_talk', { pressed: true });
await sleep(700);
spawnSync('powershell', [
  '-NoProfile',
  '-Command',
  `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Volume = 100; $s.Speak('${sentence}')`,
]);
await sleep(900);
await invoke('push_to_talk', { pressed: false });
await sleep(12000);
console.log('max mic level while listening:', maxLevel.toFixed(3));
ws.close();
await b.close();
