import type { TtsId } from '../model.js';

/**
 * Neutral expressive cues written by the brain (e.g. "[happy] Done! [laugh] the footer behaved").
 * Each TTS provider gets its own dialect; providers without cue support get clean text.
 */
export const NEUTRAL_CUES = [
  'happy',
  'excited',
  'calm',
  'curious',
  'sad',
  'empathetic',
  'surprised',
  'proud',
  'worried',
  'laugh',
  'chuckle',
  'sigh',
  'whisper',
  'pause',
  'long-pause',
  'emphasis',
] as const;
export type NeutralCue = (typeof NEUTRAL_CUES)[number];

const ELEVENLABS_V3: Record<NeutralCue, string | null> = {
  happy: '[happy]',
  excited: '[excited]',
  calm: '[calm]',
  curious: '[curious]',
  sad: '[sad]',
  empathetic: '[sympathetic]',
  surprised: '[surprised]',
  proud: '[proudly]',
  worried: '[nervous]',
  laugh: '[laughs]',
  chuckle: '[chuckles]',
  sigh: '[sighs]',
  whisper: '[whispers]',
  pause: '[short pause]',
  'long-pause': '[long pause]',
  emphasis: null,
};

const FISH: Record<NeutralCue, string | null> = {
  happy: '[happy]',
  excited: '[excited]',
  calm: '[relaxed]',
  curious: '[curious]',
  sad: '[sad]',
  empathetic: '[empathetic]',
  surprised: '[surprised]',
  proud: '[proud]',
  worried: '[worried]',
  laugh: '[laughing]',
  chuckle: '[chuckling]',
  sigh: '[sighing]',
  whisper: '[whispering]',
  pause: '[break]',
  'long-pause': '[long-break]',
  emphasis: '[emphasis]',
};

export type CueDialect = 'elevenlabs-v3' | 'fish' | 'none';

export function dialectFor(tts: TtsId, model?: string): CueDialect {
  if (tts === 'fish') return 'fish';
  if (tts === 'elevenlabs' && (!model || model === 'eleven_v3')) return 'elevenlabs-v3';
  return 'none';
}

const CUE_RE = /\s*\[([a-z][a-z -]{0,24})\]\s*/gi;

/** Converts neutral cues to a provider dialect; unknown bracketed text is removed. */
export function renderCues(text: string, dialect: CueDialect): string {
  let count = 0;
  const out = text.replace(CUE_RE, (_m, raw: string) => {
    const cue = raw.trim().toLowerCase() as NeutralCue;
    if (dialect === 'none' || !NEUTRAL_CUES.includes(cue)) return ' ';
    if (++count > 3) return ' '; // never more than three effects per reply
    const tag = (dialect === 'fish' ? FISH : ELEVENLABS_V3)[cue];
    return tag ? ` ${tag} ` : ' ';
  });
  return out.replace(/\s{2,}/g, ' ').trim();
}

export const stripCues = (text: string): string => renderCues(text, 'none');

/** Plain spoken text: no markdown emphasis, headings, bullets or line breaks. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*|__/g, '')
    .replace(/^\s*(#{1,6}|[-*•]|\d+\.)\s+/gm, '')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1')
    .replace(/\s*\n+\s*/g, ' ')
    .trim();
}

/** Splits a streaming reply into sentence-sized chunks for low-latency TTS. */
export class SentenceChunker {
  private buf = '';
  push(delta: string): string[] {
    this.buf += delta;
    const out: string[] = [];
    // A sentence ends at . ! ? … followed by whitespace, unless it looks like a decimal or an abbreviation.
    const re = /([^.!?…]*?(?:[.!?…]+)(?=\s))\s+/y;
    let consumed = 0;
    re.lastIndex = 0;
    for (;;) {
      re.lastIndex = consumed;
      const m = re.exec(this.buf);
      if (!m || m[1] === undefined) break;
      const s = m[1].trim();
      if (s.length >= 2 && !/\b(e\.g|i\.e|ecc|es|sig|dott|mr|mrs|dr)\.$/i.test(s)) out.push(s);
      else if (s.length >= 2) {
        // abbreviation: keep accumulating
        break;
      }
      consumed = re.lastIndex;
    }
    this.buf = this.buf.slice(consumed);
    return out;
  }
  flush(): string | null {
    const s = this.buf.trim();
    this.buf = '';
    return s.length ? s : null;
  }
}
