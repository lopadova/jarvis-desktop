/**
 * Streaming TTS for router replies: Jarvis starts speaking the `speak` field while the brain is still
 * writing the rest of the JSON.
 *
 * Safety (R4): text is spoken early only when
 *  - the `action` field is complete and is `answer`, `clarify` or `status` (the grounding check never
 *    rewrites those; actions that start work are always spoken after validation and grounding);
 *  - a whole sentence of `speak` is available (the first sentence is buffered until it is complete);
 *  - the sentence does not claim that something was remembered (the memory check runs after parsing
 *    and may replace such a line), those sentences wait for the final, validated reply.
 * If the final reply fails validation or turns out to be a different action, the stream is cancelled
 * and speech stops at once; the validated reply is then spoken normally.
 */
import { SentenceChunker } from '@jarvis/core';
import type { SpeechStream, VoiceOutput } from './output.js';

/** Actions whose `speak` may be spoken before the reply has been validated. */
export const STREAMABLE_ACTIONS: ReadonlySet<string> = new Set(['answer', 'clarify', 'status']);

/** Sentences that claim a memory side effect wait for the post-parse memory check. */
const MEMORY_CLAIM = /\b(remember|noted|memor|ricord|annotat)/i;

export interface ScannedFields {
  /** The `action` value, set only once its string is complete. */
  action?: string;
  /** Decoded `speak` value so far (a prefix of the final value). */
  speak: string;
  speakComplete: boolean;
}

interface StringRead {
  value: string;
  end: number;
  closed: boolean;
}

/** Decodes a JSON string starting after its opening quote; stops before an incomplete escape. */
function readString(text: string, start: number): StringRead {
  let out = '';
  let i = start;
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === '"') return { value: out, end: i + 1, closed: true };
    if (ch !== '\\') {
      out += ch;
      i++;
      continue;
    }
    const next = text[i + 1];
    if (next === undefined) break; // escape split across deltas
    if (next === 'u') {
      const hex = text.slice(i + 2, i + 6);
      if (hex.length < 4) break;
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return { value: out, end: i, closed: false };
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += 6;
      continue;
    }
    const map: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
    out += map[next] ?? next;
    i += 2;
  }
  return { value: out, end: i, closed: false };
}

/** Skips a nested object/array starting at `start` (string-aware). Returns the index after it, or -1. */
function skipNested(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      const s = readString(text, i + 1);
      if (!s.closed) return -1;
      i = s.end - 1;
    } else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

const isWs = (ch: string | undefined): boolean => ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t';

/**
 * Tolerant scan of a partial JSON object for the top-level `action` and `speak` fields. Anything that
 * cannot be read yet ends the scan; the caller rescans when more text arrives (replies are small).
 */
export function scanRouterFields(text: string): ScannedFields {
  const out: ScannedFields = { speak: '', speakComplete: false };
  let i = text.indexOf('{');
  if (i < 0) return out;
  i++;
  const seen = new Set<string>();
  for (;;) {
    while (isWs(text[i]) || text[i] === ',') i++;
    if (i >= text.length || text[i] === '}') return out;
    if (text[i] !== '"') return out;
    const key = readString(text, i + 1);
    if (!key.closed) return out;
    i = key.end;
    while (isWs(text[i])) i++;
    if (text[i] !== ':') return out;
    i++;
    while (isWs(text[i])) i++;
    if (i >= text.length) return out;
    const ch = text[i];
    const first = !seen.has(key.value);
    seen.add(key.value);
    if (ch === '"') {
      const v = readString(text, i + 1);
      if (first && key.value === 'speak') {
        out.speak = v.value;
        out.speakComplete = v.closed;
      }
      if (first && key.value === 'action' && v.closed) out.action = v.value;
      if (!v.closed) return out;
      i = v.end;
    } else if (ch === '{' || ch === '[') {
      const end = skipNested(text, i);
      if (end < 0) return out;
      i = end;
    } else {
      while (i < text.length && text[i] !== ',' && text[i] !== '}') i++;
      if (i >= text.length) return out;
    }
  }
}

/** Feeds brain deltas, speaks safe sentences early, and reconciles with the validated reply. */
export class ReplySpeechStream {
  private raw = '';
  private fed = '';
  private readonly chunker = new SentenceChunker();
  private stream: SpeechStream | null = null;
  private readonly held: string[] = [];
  private holding = false;
  private dead = false;
  private action: string | undefined;
  /** Sentences already handed to TTS. */
  readonly spoken: string[] = [];

  constructor(private readonly voice: Pick<VoiceOutput, 'stream' | 'stop'>) {}

  get started(): boolean {
    return this.stream !== null;
  }

  /** The action the stream committed to (undefined until known). */
  get committedAction(): string | undefined {
    return this.action;
  }

  push(delta: string): void {
    if (this.dead) return;
    this.raw += delta;
    const f = scanRouterFields(this.raw);
    if (!f.action) return;
    if (!STREAMABLE_ACTIONS.has(f.action)) {
      this.dead = true;
      return;
    }
    this.action = f.action;
    if (f.speak.length <= this.fed.length || !f.speak.startsWith(this.fed)) return;
    const add = f.speak.slice(this.fed.length);
    this.fed = f.speak;
    for (const s of this.chunker.push(add)) this.emit(s);
  }

  private emit(sentence: string): void {
    if (this.holding || MEMORY_CLAIM.test(sentence)) {
      this.holding = true;
      this.held.push(sentence);
      return;
    }
    if (!this.stream) this.stream = this.voice.stream();
    this.stream.push(`${sentence} `);
    this.spoken.push(sentence);
  }

  /** The reply failed validation or became another action: stop speaking now. */
  cancel(): void {
    this.dead = true;
    if (this.stream) this.voice.stop();
    this.stream = null;
  }

  /**
   * Called with the validated text to say. Speaks what is still missing and resolves when done.
   * Returns false when nothing was streamed (the caller then speaks `final` the normal way).
   */
  async finish(final: string): Promise<boolean> {
    this.dead = true;
    const stream = this.stream;
    if (!stream) return false;
    if (final.startsWith(this.fed)) {
      for (const s of this.held.splice(0)) stream.push(`${s} `);
      const rest = final.slice(this.fed.length);
      for (const s of this.chunker.push(rest)) stream.push(`${s} `);
      const tail = this.chunker.flush();
      if (tail) stream.push(tail);
    } else {
      // The validated line differs from what streamed (e.g. a memory claim was replaced): say it.
      stream.push(final);
    }
    await stream.end();
    return true;
  }
}
