import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SECRET_KEYS } from '@jarvis/core';
import { describe, expect, it } from 'vitest';
import { createSttRegistry, ElevenLabsStt, OpenAiStt } from '../src/stt/cloud.js';
import { pcm16ToWav } from '../src/stt/wav.js';
import { ElevenLabsTts } from '../src/tts/elevenlabs.js';
import { FishTts } from '../src/tts/fish.js';
import { floatToPcm16, KokoroTts } from '../src/tts/kokoro.js';
import { OpenAiTts } from '../src/tts/openai.js';
import { downloadVerified, PiperTts, piperPaths } from '../src/tts/piper.js';
import { createTtsRegistry } from '../src/tts/registry.js';
import { collect, json, makeDeps, mockFetch, type RecordedCall } from './helpers.js';

const audio = () =>
  new Response(new Uint8Array([0xff, 0xfb, 1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
const bodyOf = (c: RecordedCall | undefined) => JSON.parse(c?.body as string) as Record<string, unknown>;
const TEXT = '[happy] Done! [laugh] The footer behaves now.';

describe('ElevenLabs TTS', () => {
  const setup = (patch = {}) => {
    const m = mockFetch([
      ['/v1/text-to-speech/', audio],
      [
        'GET https://api.elevenlabs.io/v2/voices',
        () =>
          json({
            voices: [
              {
                voice_id: 'v-en',
                name: 'Brian',
                labels: { accent: 'american' },
                verified_languages: [{ language: 'en' }],
              },
              {
                voice_id: 'v-it',
                name: 'Giulia',
                labels: { accent: 'italian' },
                verified_languages: [{ language: 'it' }],
              },
            ],
          }),
      ],
    ]);
    const d = makeDeps({ fetch: m.fetch, patch });
    d.secrets.map.set(SECRET_KEYS.elevenlabsApiKey, 'xi-test');
    return { ...m, tts: new ElevenLabsTts(d.deps) };
  };

  it('streams mp3 from the v3 model with rendered audio tags', async () => {
    const { tts, calls } = setup();
    const out = await tts.synthesize({ text: TEXT, locale: 'it' });
    expect(out.mime).toBe('audio/mpeg');
    expect((await collect(out.chunks)).length).toBe(5);
    const c = calls[0] as RecordedCall;
    expect(c.url).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb/stream?output_format=mp3_44100_128',
    );
    expect(c.headers['xi-api-key']).toBe('xi-test');
    expect(bodyOf(c)).toMatchObject({
      text: '[happy] Done! [laughs] The footer behaves now.',
      model_id: 'eleven_v3',
      language_code: 'it',
      voice_settings: { speed: 1 },
    });
  });

  it('strips cues for flash v2.5 and honours the preferred voice', async () => {
    const { tts, calls } = setup({ elevenlabsModel: 'eleven_flash_v2_5', ttsVoice: { 'elevenlabs.en': 'my-voice' } });
    await tts.synthesize({ text: TEXT, locale: 'en', speed: 1.5 });
    expect(calls[0]?.url).toContain('/text-to-speech/my-voice/stream');
    expect(bodyOf(calls[0])).toMatchObject({
      text: 'Done! The footer behaves now.',
      model_id: 'eleven_flash_v2_5',
      voice_settings: { speed: 1.2 },
    });
  });

  it('sends the ElevenLabs voice settings chosen in Settings', async () => {
    const { tts, calls } = setup({
      elevenlabsVoice: { stability: 0.2, similarityBoost: 0.9, style: 0.4, speakerBoost: false },
    });
    await tts.synthesize({ text: 'Hi', locale: 'en' });
    expect(bodyOf(calls[0])).toMatchObject({
      voice_settings: { stability: 0.2, similarity_boost: 0.9, style: 0.4, use_speaker_boost: false, speed: 1 },
    });
  });

  it('omits language_code for multilingual v2', async () => {
    const { tts, calls } = setup({ elevenlabsModel: 'eleven_multilingual_v2' });
    await tts.synthesize({ text: 'Hi', locale: 'en' });
    expect(bodyOf(calls[0])).not.toHaveProperty('language_code');
  });

  it('lists voices, ranking the locale first', async () => {
    const { tts } = setup();
    const voices = await tts.voices('', 'it');
    expect(voices.map((v) => v.id)).toEqual(['v-it', 'v-en']);
    expect(voices[0]).toMatchObject({ name: 'Giulia', locale: 'it', tags: ['italian'] });
  });

  it('is not configured without a key', async () => {
    expect(await new ElevenLabsTts(makeDeps().deps).configured()).toBe(false);
  });
});

describe('Fish Audio TTS', () => {
  it('sends the model header, fish cue dialect and reference voice', async () => {
    const m = mockFetch([
      ['POST https://api.fish.audio/v1/tts', audio],
      [
        'GET https://api.fish.audio/model',
        () => json({ total: 1, items: [{ _id: 'ref-1', title: 'Narratore', languages: ['it'], tags: ['calm'] }] }),
      ],
    ]);
    const d = makeDeps({ fetch: m.fetch, patch: { ttsVoice: { fish: 'ref-1' } } });
    d.secrets.map.set(SECRET_KEYS.fishApiKey, 'fish-key');
    const tts = new FishTts(d.deps);
    expect(await tts.configured()).toBe(true);
    const out = await tts.synthesize({ text: TEXT, locale: 'it' });
    expect(out.mime).toBe('audio/mpeg');
    const c = m.calls[0] as RecordedCall;
    expect(c.headers.model).toBe('s2-pro');
    expect(c.headers.authorization).toBe('Bearer fish-key');
    expect(bodyOf(c)).toMatchObject({
      text: '[happy] Done! [laughing] The footer behaves now.',
      reference_id: 'ref-1',
      format: 'mp3',
    });
    const voices = await tts.voices('narr', 'it-IT');
    expect(m.calls[1]?.url).toContain('title=narr');
    expect(m.calls[1]?.url).toContain('language=it');
    expect(voices).toEqual([{ id: 'ref-1', name: 'Narratore', locale: 'it', tags: ['calm'] }]);
  });
});

describe('OpenAI TTS', () => {
  it('uses gpt-4o-mini-tts with the API key and strips cues', async () => {
    const m = mockFetch([['POST https://api.openai.com/v1/audio/speech', audio]]);
    const d = makeDeps({ fetch: m.fetch });
    const tts = new OpenAiTts(d.deps);
    await expect(tts.synthesize({ text: 'x', locale: 'en' })).rejects.toMatchObject({ code: 'not-configured' });
    d.secrets.map.set(SECRET_KEYS.openaiApiKey, 'sk-test');
    await tts.synthesize({ text: TEXT, locale: 'en' });
    expect(m.calls[0]?.headers.authorization).toBe('Bearer sk-test');
    expect(bodyOf(m.calls[0])).toMatchObject({
      model: 'gpt-4o-mini-tts',
      input: 'Done! The footer behaves now.',
      voice: 'onyx',
      response_format: 'mp3',
    });
  });
});

describe('local TTS', () => {
  it('piper is not configured until the binary and voice exist', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'jarvis-piper-'));
    const tts = new PiperTts(makeDeps({ dataDir }).deps);
    expect(await tts.configured()).toBe(false);
    await expect(tts.synthesize({ text: 'hi', locale: 'en' })).rejects.toMatchObject({ code: 'not-configured' });
    expect(piperPaths(dataDir, 'win32').binary).toBe(join(dataDir, 'models', 'piper', 'piper', 'piper.exe'));
    expect((await tts.voices(undefined, 'it')).map((v) => v.id)).toEqual(['it_IT-paola-medium']);
  });

  it('downloads with SHA-256 verification and rejects tampered files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-dl-'));
    const payload = new TextEncoder().encode('voice-bytes');
    const sha256 = createHash('sha256').update(payload).digest('hex');
    const m = mockFetch([['https://example.test/voice', () => new Response(payload)]]);
    await downloadVerified(m.fetch, { url: 'https://example.test/voice', sha256 }, join(dir, 'ok.onnx'));
    expect(readFileSync(join(dir, 'ok.onnx'), 'utf8')).toBe('voice-bytes');
    await expect(
      downloadVerified(m.fetch, { url: 'https://example.test/voice', sha256: '0'.repeat(64) }, join(dir, 'bad.onnx')),
    ).rejects.toThrow(/Checksum mismatch/);
    expect(existsSync(join(dir, 'bad.onnx'))).toBe(false);
    expect(existsSync(join(dir, 'bad.onnx.part'))).toBe(false);
  });

  it('kokoro is optional: unconfigured without the module, PCM when present', async () => {
    const { deps } = makeDeps();
    expect(await new KokoroTts(deps, async () => null).configured()).toBe(false);
    const seen: Array<{ text: string; voice: string }> = [];
    const fake = new KokoroTts(deps, async () => ({
      KokoroTTS: {
        from_pretrained: async () => ({
          generate: async (text: string, o: { voice: string }) => {
            seen.push({ text, voice: o.voice });
            return { audio: new Float32Array([0, 1, -1, 0.5]), sampling_rate: 24000 };
          },
        }),
      },
    }));
    const out = await fake.synthesize({ text: TEXT, locale: 'en' });
    expect(out.mime).toBe('audio/pcm;rate=24000');
    expect((await collect(out.chunks)).length).toBe(8);
    expect(seen[0]).toEqual({ text: 'Done! The footer behaves now.', voice: 'bm_george' });
    expect(Array.from(new Int16Array(floatToPcm16(new Float32Array([1, -1])).buffer))).toEqual([32767, -32768]);
  });
});

describe('TTS registry', () => {
  it('wires cloud and local providers but not "system"', () => {
    const reg = createTtsRegistry(makeDeps().deps);
    expect(reg.list().map((p) => p.id)).toEqual(['elevenlabs', 'fish', 'openai', 'piper', 'kokoro']);
    expect(reg.get('system')).toBeUndefined();
    expect(reg.get('fish')?.supportsCues).toBe(true);
    expect(reg.get('openai')?.supportsCues).toBe(false);
  });
});

describe('cloud STT', () => {
  const pcm = new Uint8Array(3200); // 100 ms of silence

  it('builds a valid WAV header', () => {
    const wav = pcm16ToWav(pcm);
    const v = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe('WAVE');
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(3200);
    expect(wav.length).toBe(3244);
  });

  it('OpenAI: uploads WAV to gpt-4o-transcribe', async () => {
    const m = mockFetch([
      ['POST https://api.openai.com/v1/audio/transcriptions', () => json({ text: ' ciao Jarvis ' })],
    ]);
    const d = makeDeps({ fetch: m.fetch });
    d.secrets.map.set(SECRET_KEYS.openaiApiKey, 'sk-test');
    expect(await new OpenAiStt(d.deps).transcribe({ pcm, locale: 'it' })).toEqual({ text: 'ciao Jarvis' });
    const form = m.calls[0]?.body as FormData;
    expect(form.get('model')).toBe('gpt-4o-transcribe');
    expect(form.get('language')).toBe('it');
    const file = form.get('file') as File;
    expect(file.type).toBe('audio/wav');
    expect(file.size).toBe(3244);
  });

  it('ElevenLabs: uploads WAV to Scribe', async () => {
    const m = mockFetch([
      ['POST https://api.elevenlabs.io/v1/speech-to-text', () => json({ text: 'hello', language_code: 'en' })],
    ]);
    const d = makeDeps({ fetch: m.fetch });
    d.secrets.map.set(SECRET_KEYS.elevenlabsApiKey, 'xi');
    expect(await new ElevenLabsStt(d.deps).transcribe({ pcm, locale: 'en' })).toEqual({ text: 'hello' });
    expect(m.calls[0]?.headers['xi-api-key']).toBe('xi');
    expect((m.calls[0]?.body as FormData).get('model_id')).toBe('scribe_v2');
  });

  it('registry exposes cloud STT only', () => {
    expect(
      createSttRegistry(makeDeps().deps)
        .list()
        .map((p) => p.id),
    ).toEqual(['openai', 'elevenlabs']);
  });
});

describe('Payment Required', () => {
  it('maps HTTP 402 (out of credit) to cap-reached so the UI can say so', async () => {
    const { httpError } = await import('../src/util/http.js');
    const err = httpError('fish', { status: 402, message: 'Insufficient API credit', code: '' } as never);
    expect(err.code).toBe('cap-reached');
  });
});
