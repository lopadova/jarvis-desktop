/**
 * Stage 12 — ElevenLabs through the real app. The API key is read from a file you provide (path in argv or
 * ELEVENLABS_KEY_FILE), stored in the OS keyring through the app (`secrets.set`, like the Settings field does) and
 * NEVER printed. Checks: the key is valid, the app sees ElevenLabs as ready, lists voices, and a preview plays without
 * falling back to the system voice. Your previous voice provider is restored at the end.
 * Usage: node scripts/e2e-app/12-elevenlabs.mjs "C:\path\ELEVENLABS_API_KEY.txt"
 */
import { readFileSync } from 'node:fs';
import { check, connect, ensureApp, pageFor, sidecar, sleep, summary } from './lib.mjs';

const keyFile = process.argv[2] ?? process.env.ELEVENLABS_KEY_FILE;
if (!keyFile) throw new Error('pass the path of the file that contains the ElevenLabs API key');
const raw = readFileSync(keyFile, 'utf8');
const key = (raw.match(/[A-Za-z0-9_-]{20,}/g) ?? []).at(-1) ?? raw.trim();

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
const preview = await api.call('tts.preview', { provider: 'elevenlabs', voiceId: voices[0]?.id });
check('preview request accepted', !preview.error, preview.error?.message);
await sleep(8000);
const toasts = await home.evaluate(() => document.body.innerText);
check('no "used the system voice" warning appeared', !/system voice|voce di sistema/i.test(toasts));

await api.call('settings.update', { patch: { tts: prev.tts ?? 'system' } });
api.close();
await browser.close();
process.exit(summary() ? 1 : 0);
