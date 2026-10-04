/**
 * Stage 10 — speech recognition end to end WITHOUT a human voice: hold push-to-talk in the real app while the PC
 * speaks a sentence through its speakers (Windows SAPI); the microphone picks it up, Whisper transcribes it and the
 * assistant answers. Needs speakers + a microphone that can hear them, and the Whisper model downloaded.
 * Usage: node scripts/e2e-app/10-stt-acoustic.mjs ["sentence"]
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  check,
  connect,
  conversation,
  DATA,
  ensureApp,
  pageFor,
  shot,
  sidecar,
  sleep,
  summary,
  waitConversation,
} from './lib.mjs';

const sentence = process.argv[2] ?? 'what time is it';
await ensureApp();
const browser = await connect();
await sleep(3000);
const home = await pageFor(browser, 'home');
await home.bringToFront();
const invoke = (cmd, args) => home.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args ?? {}]);

const api = await sidecar(home);
const before = (await api.call('settings.get', {})).result?.settings ?? {};
// English sentence: let Whisper listen in English for this run (restored at the end).
await api.call('settings.update', { patch: { locale: 'en' } });
const onDisk = readdirSync(join(DATA, 'models')).filter((d) => d.startsWith('sherpa-onnx-whisper'));
check(
  `a Whisper model is installed on disk (selected: whisper-${before.whisperModel})`,
  onDisk.length > 0,
  onDisk.join(', '),
);

await invoke('push_to_talk', { pressed: true });
await sleep(700);
const say = spawnSync(
  'powershell',
  [
    '-NoProfile',
    '-Command',
    `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Volume = 100; $s.Speak('${sentence.replace(/'/g, '')}')`,
  ],
  { encoding: 'utf8' },
);
check('the PC spoke the sentence through the speakers', say.status === 0, say.stderr);
await sleep(900);
await invoke('push_to_talk', { pressed: false });

const heard = await waitConversation(home, (c) => /time/i.test(c.split('|').slice(-6).join('|')), 60000);
await shot(home, 'stt-acoustic');
check('the microphone → Whisper → assistant chain produced a reply', !!heard, (await conversation(home)).slice(-300));
await api.call('settings.update', { patch: { locale: before.locale ?? 'en' } });
api.close();
await browser.close();
process.exit(summary() ? 1 : 0);
