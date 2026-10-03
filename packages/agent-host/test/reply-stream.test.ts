import type { BrainRequest } from '@jarvis/core';
import { describe, expect, it } from 'vitest';
import type { SpeechStream } from '../src/voice/output.js';
import { ReplySpeechStream, scanRouterFields } from '../src/voice/reply-stream.js';
import { makeApp, routerJson, until } from './helpers.js';

/** Feeds `text` in chunks of `size` characters. */
function feed(target: { push(d: string): void }, text: string, size = 1): void {
  for (let i = 0; i < text.length; i += size) target.push(text.slice(i, i + size));
}

class FakeVoice {
  pushed: string[] = [];
  ended = false;
  stopped = 0;
  stream(): SpeechStream {
    return {
      push: (d) => {
        this.pushed.push(d);
      },
      end: async () => {
        this.ended = true;
      },
    };
  }
  stop(): void {
    this.stopped++;
  }
  get text(): string {
    return this.pushed.join('').replace(/\s+/g, ' ').trim();
  }
}

describe('scanRouterFields (incremental JSON)', () => {
  it('extracts action and a partial speak, decoding escapes', () => {
    const json = JSON.stringify({ action: 'answer', speak: 'He said "hi" \\ then\nleft. Città è ok 🎉.' });
    for (let cut = 0; cut <= json.length; cut++) {
      const f = scanRouterFields(json.slice(0, cut));
      const full = 'He said "hi" \\ then\nleft. Città è ok 🎉.';
      expect(full.startsWith(f.speak)).toBe(true);
      if (f.action !== undefined) expect(f.action).toBe('answer');
    }
    const done = scanRouterFields(json);
    expect(done).toEqual({
      action: 'answer',
      speak: 'He said "hi" \\ then\nleft. Città è ok 🎉.',
      speakComplete: true,
    });
  });

  it('handles \\u escapes split across deltas, nested values, fences and speak before action', () => {
    const json = `\`\`\`json\n{"quickReplies":["a","b}"],"reminder":{"text":"x\\"}"},"speak":"Caf\\u00e9 time.","action":"status"}`;
    for (let cut = 0; cut <= json.length; cut++) {
      const f = scanRouterFields(json.slice(0, cut));
      expect('Café time.'.startsWith(f.speak)).toBe(true);
    }
    expect(scanRouterFields(json)).toMatchObject({ action: 'status', speak: 'Café time.' });
    expect(scanRouterFields('{"action":"answ')).toEqual({ speak: '', speakComplete: false });
    expect(scanRouterFields('no json here')).toEqual({ speak: '', speakComplete: false });
  });

  it('ignores a nested "speak" key and duplicate keys', () => {
    const f = scanRouterFields('{"reminder":{"speak":"evil"},"action":"answer","speak":"good.","speak":"x"}');
    expect(f).toMatchObject({ action: 'answer', speak: 'good.' });
  });
});

describe('ReplySpeechStream', () => {
  it('speaks the first sentence only once complete and the action is known to be safe', () => {
    const v = new FakeVoice();
    const s = new ReplySpeechStream(v);
    feed(s, '{"action":"answer","speak":"It is sunny');
    expect(v.pushed).toEqual([]);
    feed(s, ' today. And');
    expect(v.text).toBe('It is sunny today.');
    expect(s.started).toBe(true);
  });

  it('never speaks before the action is known, nor for actions that start work', () => {
    const v = new FakeVoice();
    const s = new ReplySpeechStream(v);
    feed(s, '{"speak":"Deleting everything now. Bye. ","action":"sp');
    expect(v.pushed).toEqual([]);
    feed(s, 'awn","task":"rm -rf"}');
    expect(v.pushed).toEqual([]);
    expect(s.started).toBe(false);
  });

  it('holds memory claims until the validated reply confirms them', async () => {
    const v = new FakeVoice();
    const s = new ReplySpeechStream(v);
    feed(
      s,
      '{"action":"answer","speak":"Sure thing. I will remember that you like tea. Anything else? ","remember":"x"}',
    );
    expect(v.text).toBe('Sure thing.');
    // The memory check replaced the line: the claim is never spoken.
    await s.finish('Sorry, I did not catch that.');
    expect(v.text).toBe('Sure thing. Sorry, I did not catch that.');
    expect(v.text).not.toMatch(/remember/);
  });

  it('finish() says only the missing part when the final text extends what streamed', async () => {
    const v = new FakeVoice();
    const s = new ReplySpeechStream(v);
    feed(s, '{"action":"clarify","speak":"Which project? The web one or the');
    expect(await s.finish('Which project? The web one or the API?')).toBe(true);
    expect(v.text).toBe('Which project? The web one or the API?');
    expect(v.ended).toBe(true);
  });

  it('cancel() stops speech immediately', () => {
    const v = new FakeVoice();
    const s = new ReplySpeechStream(v);
    feed(s, '{"action":"answer","speak":"One. Two. ');
    s.cancel();
    expect(v.stopped).toBe(1);
    feed(s, 'Three. ');
    expect(v.text).toBe('One. Two.');
  });
});

/** A brain that streams its JSON through onDelta, pausing after `pauseAfter` characters until released. */
function streamingStep(json: string, pauseAfter: number, gate: Promise<void>) {
  return async (req: BrainRequest) => {
    for (let i = 0; i < json.length; i++) {
      if (i === pauseAfter) await gate;
      req.onDelta?.(json[i] as string);
    }
    return { text: json };
  };
}

describe('orchestrator streams router answers', () => {
  it('starts speaking the answer before the brain finishes', async () => {
    const t = await makeApp();
    const json = routerJson({ action: 'answer', speak: 'Paris is the capital. It has about two million people.' }).text;
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    t.brain.push(streamingStep(json, json.indexOf('It has'), gate));
    const turn = t.app.orchestrator.submit('what is the capital of France', 'text');
    await until(() => t.host.spoken().length > 0);
    expect(t.host.spoken()).toEqual(['Paris is the capital.']);
    release();
    await turn;
    expect(t.host.spoken()).toEqual(['Paris is the capital.', 'It has about two million people.']);
    const chat = t.store.recentChat(10).filter((m) => m.role === 'jarvis');
    expect(chat.map((m) => m.text)).toEqual(['Paris is the capital. It has about two million people.']);
  });

  it('a reply that fails validation stops speaking and the repaired reply is spoken normally', async () => {
    const t = await makeApp();
    // Valid action + speak, then an invalid field (5 quick replies > max 4).
    const bad = JSON.stringify({
      action: 'answer',
      speak: 'First part. Unfinished second part',
      quickReplies: ['a', 'b', 'c', 'd', 'e'],
    });
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    t.brain.push(
      streamingStep(bad, bad.indexOf('quickReplies'), gate),
      routerJson({ action: 'answer', speak: 'Fixed.' }),
    );
    const turn = t.app.orchestrator.submit('tell me something', 'text');
    await until(() => t.host.spoken().length > 0);
    release();
    await turn;
    expect(t.host.of('host.audio.stop').length).toBeGreaterThan(0);
    // The incomplete last sentence of the invalid reply is never spoken; the repaired one is.
    expect(t.host.spoken()).toEqual(['First part.', 'Fixed.']);
  });

  it('a spawn reply is never streamed (it must pass grounding first)', async () => {
    const t = await makeApp();
    const json = routerJson({
      action: 'spawn',
      speak: 'Deleting your files now. Done soon.',
      task: 'delete the files',
    }).text;
    t.brain.push(async (req: BrainRequest) => {
      for (const ch of json) req.onDelta?.(ch);
      expect(t.host.spoken()).toEqual([]);
      return { text: json };
    });
    await t.app.orchestrator.submit('what time is the meeting', 'text');
    expect(t.host.spoken().join(' ')).not.toMatch(/Deleting/);
  });
});
