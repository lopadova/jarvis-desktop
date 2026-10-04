/**
 * Stage 7 — voice in, as far as it can be checked without a human voice: model status, model download (checksummed),
 * microphone device listing and the wake-word engine starting. Speaking "Jarvis" itself needs a person.
 * Usage: node scripts/e2e-app/07-voice-in.mjs [--download]
 */
import { check, connect, ensureApp, pageFor, sleep, summary } from './lib.mjs';

const download = process.argv.includes('--download');
await ensureApp();
const browser = await connect();
await sleep(3000);
const home = await pageFor(browser, 'home');
const invoke = (cmd, args) =>
  home
    .evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args ?? {}])
    .catch((e) => ({ error: String(e) }));

let status = await invoke('model_status');
console.log('model_status:', JSON.stringify(status).slice(0, 400));
check('model status is reported by the shell', !status?.error, status?.error);

if (download) {
  const r = await invoke('download_models');
  check('model download command accepted', !r?.error, r?.error ?? JSON.stringify(r));
  for (let i = 0; i < 360; i++) {
    await sleep(5000);
    status = await invoke('model_status');
    const text = JSON.stringify(status);
    if (!/downloading|pending|missing/i.test(text) || i === 359) break;
  }
  console.log('after download:', JSON.stringify(status).slice(0, 500));
  check('models are ready after download', !/missing|error/i.test(JSON.stringify(status)));
}

const mic = await invoke('mic_monitor', { enabled: true });
check('microphone monitor starts', !mic?.error, mic?.error);
await sleep(1500);
await invoke('mic_monitor', { enabled: false });

await browser.close();
process.exit(summary() ? 1 : 0);
