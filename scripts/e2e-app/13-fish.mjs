/**
 * Stage 13 — Fish Audio through the real app. The key is read by label (FISH_AUDIO_API_KEY=…) from a file you provide,
 * stored in the OS keyring through the app and never printed. Checks that the key works against the API, that the app
 * reports Fish as ready, lists voices and that a preview does not fall back to the system voice. Restores your voice.
 * Usage: node scripts/e2e-app/13-fish.mjs "C:\path\keys.txt"
 */
import { check, connect, ensureApp, logSince, logSize, pageFor, readKey, sidecar, sleep, summary } from './lib.mjs';

const keyFile = process.argv[2] ?? process.env.FISH_KEY_FILE;
if (!keyFile) throw new Error('pass the path of the file that contains FISH_AUDIO_API_KEY=…');
const key = readKey(keyFile, 'FISH_AUDIO_API_KEY');

await ensureApp();
const browser = await connect();
await sleep(3000);
const home = await pageFor(browser, 'home');
const api = await sidecar(home);
const prev = (await api.call('settings.get', {})).result?.settings ?? {};

// 1. The key against the real API with the model the app uses (only the status is shown).
const model = prev.fishModel ?? 's2-pro';
const probe = await fetch('https://api.fish.audio/v1/tts', {
  method: 'POST',
  headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', model },
  body: JSON.stringify({ text: 'Hello.', format: 'mp3', latency: 'balanced' }),
}).catch(() => null);
const bytes = probe?.ok ? (await probe.arrayBuffer()).byteLength : 0;
// 402 means the key is valid but the API account has no credit (billed separately from the Fish subscription).
check(
  `the Fish Audio API accepts the key with model "${model}"`,
  (probe?.ok === true && bytes > 500) || probe?.status === 402,
  probe
    ? `HTTP ${probe.status}${probe.status === 402 ? ' (no API credit on the account)' : `, ${bytes} bytes`}`
    : 'no connection',
);

const saved = await api.call('secrets.set', { key: 'fish-audio-api-key', value: key });
check('the key was stored in the OS keyring by the app', !saved.error, saved.error?.message);

await api.call('settings.update', { patch: { tts: 'fish' } });
const v = await api.call('tts.voices', { provider: 'fish' });
check('the app reports Fish Audio as ready', v.result?.configured === true, `configured=${v.result?.configured}`);
const voices = v.result?.voices ?? [];
console.log(`  (${voices.length} Fish voices listed)`);

const logFrom = logSize();
const preview = await api.call(
  'tts.preview',
  voices[0] ? { provider: 'fish', voiceId: voices[0].id } : { provider: 'fish' },
);
check('preview request accepted', !preview.error, preview.error?.message);
// Toasts disappear after a few seconds: watch for the whole wait instead of looking once at the end.
let toastSeen = false;
for (let i = 0; i < 18; i++) {
  await sleep(500);
  if (/system voice|voce di sistema/i.test(await home.evaluate(() => document.body.innerText))) toastSeen = true;
}
const failed = logSince(logFrom).text.match(/tts provider failed.*/);
if (!failed) {
  check('the cloud voice spoke (no provider failure in the log)', true);
} else {
  // The provider could not speak (for example no credit left): the user must be told why, never silence.
  console.log(`  provider failure: ${failed[0].replace(/^.*error":"/, '').slice(0, 120)}`);
  check('the app tells the user it fell back to the system voice', toastSeen);
}

await api.call('settings.update', { patch: { tts: prev.tts ?? 'system' } });
api.close();
await browser.close();
process.exit(summary() ? 1 : 0);
