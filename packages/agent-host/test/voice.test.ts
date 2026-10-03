import { describe, expect, it } from 'vitest';
import { FakeTts, makeApp, tick, until } from './helpers.js';

describe('voice output', () => {
  it('chunks text into sentences and uses the OS voice with cues stripped by default', async () => {
    const t = await makeApp();
    await t.app.voice.speak('[happy] **Done!** The footer is in place. Want me to open it?');
    expect(t.host.spoken()).toEqual(['Done!', 'The footer is in place.', 'Want me to open it?']);
    const listening = t.host.of('host.setListening') as { mode: string }[];
    expect(listening[0]?.mode).toBe('speaking');
    expect(listening.at(-1)?.mode).toBe('idle');
  });

  it('streams brain deltas sentence by sentence', async () => {
    const t = await makeApp();
    const s = t.app.voice.stream();
    s.push('Hello the');
    s.push('re. How are');
    await tick(5);
    expect(t.host.spoken()).toEqual(['Hello there.']);
    s.push(' you');
    await s.end();
    expect(t.host.spoken()).toEqual(['Hello there.', 'How are you']);
  });

  it('sends provider audio as begin / binary frames / end with rendered cues', async () => {
    const tts = new FakeTts('elevenlabs');
    const t = await makeApp({ tts: [tts], settings: { tts: 'elevenlabs', ttsVoice: { elevenlabs: 'v1' } } });
    await t.app.voice.speak('[happy] Hi there.');
    expect(tts.requests[0]).toMatchObject({ text: '[happy] Hi there.', voiceId: 'v1' });
    const begin = t.host.of('host.audio.begin')[0] as { utteranceId: string; mime: string };
    expect(begin.mime).toBe('audio/mpeg');
    expect(begin.utteranceId).toMatch(/^[0-9a-f]{16}$/);
    expect(t.host.frames.map((f) => f.bytes)).toEqual([3, 2]);
    expect(t.host.frames.every((f) => f.utteranceId === begin.utteranceId)).toBe(true);
    expect(t.host.of('host.audio.end')).toEqual([{ utteranceId: begin.utteranceId }]);
    expect(t.host.spoken()).toEqual([]);
  });

  it('falls back to the OS voice when the provider fails', async () => {
    const tts = new FakeTts('elevenlabs');
    tts.fail = true;
    const t = await makeApp({ tts: [tts], settings: { tts: 'elevenlabs' } });
    await t.app.voice.speak('[sigh] It broke.');
    expect(t.host.spoken()).toEqual(['It broke.']);
  });

  it('private mode never sends speech to a cloud TTS', async () => {
    const tts = new FakeTts('elevenlabs');
    const t = await makeApp({ tts: [tts], settings: { tts: 'elevenlabs', privateMode: true } });
    await t.app.voice.speak('Secret plans.');
    expect(tts.requests).toHaveLength(0);
    expect(t.host.spoken()).toEqual(['Secret plans.']);
  });

  it('stop drops the queue and tells the shell', async () => {
    const t = await makeApp();
    t.host.onPlaybackEnded = null; // playback never ends by itself
    const p = t.app.voice.speak('One. Two. Three.');
    await until(() => t.host.spoken().length === 1);
    t.app.voice.stop();
    await p;
    expect(t.host.spoken()).toEqual(['One.']);
    expect(t.host.of('host.audio.stop')).toHaveLength(1);
  });

  it('mutes during Do Not Disturb when muteDuringFocus is on', async () => {
    const t = await makeApp();
    t.app.voice.setDoNotDisturb(true);
    await t.app.voice.speak('Hello.');
    expect(t.host.spoken()).toEqual([]);
    expect(t.app.pill.state).toEqual({ kind: 'muted', reason: 'focus' });
    t.app.voice.setDoNotDisturb(false);
    await t.app.voice.speak('Hello.');
    expect(t.host.spoken()).toEqual(['Hello.']);
  });

  it('reports speaking progress on the pill from playback levels', async () => {
    const t = await makeApp();
    t.host.onPlaybackEnded = null;
    void t.app.voice.speak('First. Second.');
    await until(() => t.host.spoken().length === 1);
    t.app.voice.onPlaybackLevel(0.7);
    expect(t.app.pill.state).toMatchObject({ kind: 'speaking', text: 'First.', level: 0.7 });
    t.app.voice.stop();
  });
});
