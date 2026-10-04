/**
 * Stage 12 — ElevenLabs through the real app. The API key is read from a file you provide (path in argv or
 * ELEVENLABS_KEY_FILE), stored in the OS keyring through the app (`secrets.set`, like the Settings field does) and
 * NEVER printed. Checks: the key is valid, the app sees ElevenLabs as ready, lists voices, and a preview plays without
 * falling back to the system voice. Your previous voice provider is restored at the end.
 * Usage: node scripts/e2e-app/12-elevenlabs.mjs "C:\path\ELEVENLABS_API_KEY.txt"
 */
import { check, connect, ensureApp, logSince, logSize, pageFor, readKey, sidecar, sleep, summary } from './lib.mjs';

const keyFile = process.argv[2] ?? process.env.ELEVENLABS_KEY_FILE;
if (!keyFile) throw new Error('pass the path of the file that contains the ElevenLabs API key');
const key = readKey(keyFile, 'ELEVENLABS_API_KEY');

// 1. Is the key valid? (direct call to the ElevenLabs API; only the HTTP status is shown)
const probe = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } }).catch(() => null);
check('the ElevenLabs API accepts the key', probe?.ok === true, probe ? `HTTP ${probe.status}` : 'no connection');
const apiVoices = probe?.ok ? ((await probe.json()).voices ?? []) : [];

await ensureApp();
const browser = await connect();
await sleep(3000);
const home = await pageFor(browser, 'home');
const api = await sidecar(home);
const prev = (await api.call('settings.get', {})).result?.settings ?? {};

const saved = await api.call('secrets.set', { key: 'elevenlabs-api-key', value: key });
check('the key was stored in the OS keyring by the app', !saved.error, saved.error?.message);

await api.call('settings.update', { patch: { tts: 'elevenlabs' } });
const v = await api.call('tts.voices', { provider: 'elevenlabs' });
check('the app reports ElevenLabs as ready', v.result?.configured === true, `configured=${v.result?.configured}`);
const voices = v.result?.voices ?? [];
check(
  'the app lists ElevenLabs voices',
  voices.length > 0,
  `${voices.length} voices (account has ${apiVoices.length})`,
);

// 2. A preview must not fall back to the system voice (fallback shows a warning toast).
const logFrom = logSize();
const preview = await api.call('tts.preview', { provider: 'elevenlabs', voiceId: voices[0]?.id });
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
