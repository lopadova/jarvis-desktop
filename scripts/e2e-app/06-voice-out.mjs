/**
 * Stage 6 — voice out through the REAL app: asks the running exe for its assistant endpoint (as the UI does),
 * lists system voices and plays a preview through the real shell. Cloud voices (ElevenLabs/Fish/OpenAI) need keys the
 * user enters in the app and are not exercised here.
 * Usage: node scripts/e2e-app/06-voice-out.mjs
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { check, connect, ensureApp, pageFor, sleep, summary } from './lib.mjs';

const WebSocket = createRequire(join(process.cwd(), 'packages/mcp/package.json'))('ws');
await ensureApp();
const browser = await connect();
await sleep(3000);
const home = await pageFor(browser, 'home');
const ep = await home
  .evaluate(() => window.__TAURI_INTERNALS__.invoke('sidecar_endpoint'))
  .catch((e) => ({ error: String(e) }));
check('the shell hands the UI the assistant endpoint', !!ep?.port && !!ep?.token, ep?.error ?? `port ${ep?.port}`);

if (ep?.port) {
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
  const voices = await call('tts.voices', { provider: 'system' });
  const list = voices.result?.voices ?? [];
  check(
    'system voice request is accepted',
    !voices.error,
    voices.error?.message ?? `${list.length} listed (system voices are owned by the shell; the default voice is used)`,
  );
  const preview = await call('tts.preview', { provider: 'system', voiceId: list[0]?.id });
  check(
    'system voice preview plays without error',
    !preview.error,
    preview.error?.message ?? JSON.stringify(preview.result),
  );
  const piper = await call('tts.voices', { provider: 'piper' });
  check(
    'Piper voices are listed (local neural voices)',
    !piper.error,
    piper.error?.message ?? `${piper.result?.voices?.length ?? 0} voices`,
  );
  ws.close();
}
await browser.close();
process.exit(summary() ? 1 : 0);
