/** Phrases Whisper invents when it is fed silence or noise (training-data artefacts, not speech). */
const WHISPER_HALLUCINATION =
  /^[[(]?\s*(?:speaking in (?:a )?foreign language|sottotitoli.*|subtitles? by.*|thanks for watching.*|grazie per la visione.*|amara\.org.*|www\..*)\s*[\])]?[.!\s]*$/i;

/**
 * Whisper prints bracketed tags for silence and noise ("[BLANK_AUDIO]", "(silence)", "[Music]", "*sighs*", "♪").
 * A transcript made only of those is not speech and must never become a turn for the brain.
 */
export function isNonSpeech(text: string): boolean {
  if (WHISPER_HALLUCINATION.test(text.trim())) return true;
  const stripped = text
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|[♪♫]+/g, ' ')
    .replace(/[\s.,!?…\-–—]+/g, ' ')
    .trim();
  return stripped === '';
}

const words = (s: string): string[] =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

/**
 * Without acoustic echo cancellation, a microphone next to the speakers hears Jarvis' own voice. A transcript that is
 * mostly made of the words Jarvis said a moment ago is that echo, not the user. Short utterances ("stop", "yes")
 * are never treated as echo so commands always get through.
 */
export function isSelfEcho(heard: string, recentlySpoken: readonly string[]): boolean {
  const h = new Set(words(heard));
  if (h.size < 3) return false;
  for (const spoken of recentlySpoken) {
    const s = new Set(words(spoken));
    let shared = 0;
    for (const w of h) if (s.has(w)) shared++;
    if (shared / h.size >= 0.75) return true;
  }
  return false;
}

/**
 * Words Whisper writes for "Jarvis" as heard in English and Italian speech ("Giarvis", "Iarvis", "Jervis" …).
 * Matched on whole words only, and only at the very start of the utterance.
 */
const WAKE_WORD =
  /^(?:(?:hey|ehi|ei|ok|okay|ciao|salve)\s+)?(?:(?:j|gi|g|i|y|ch|chi)[aeio]r?v[ie]s?|[ae]rv[ie]s?)\b[\s,.:;!?-]*/i;

export interface WakeMatch {
  matched: boolean;
  /** What was said after the wake word ("" when only the wake word was heard). */
  rest: string;
}

/**
 * Decides whether an utterance transcribed by Whisper starts with the wake word. Used for the "wake word by speech
 * recognition" path, which understands Italian accents that the small English keyword spotter misses.
 */
export function matchWakeUtterance(text: string): WakeMatch {
  const t = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/^[\s"'“”«»([{*]+/u, '')
    .trim();
  const m = WAKE_WORD.exec(t);
  if (!m) return { matched: false, rest: '' };
  return {
    matched: true,
    rest: t
      .slice(m[0].length)
      .replace(/^[\s,.:;!?"'”»)\]*-]+/u, '')
      .trim(),
  };
}

const distance = (a: string, b: string): number => {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j] ?? 0;
      row[j] = Math.min(cur + 1, (row[j - 1] ?? 0) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length] ?? 0;
};

/**
 * The first word of an utterance when it merely LOOKS like the wake word ("Garvis", "Javis", "Jarbis" …) but did not
 * match. Used to log near-misses for diagnosing wake-word problems without logging ordinary speech.
 */
export function nearWakeWord(text: string): string | null {
  const first = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/^[^\p{L}]+/u, '')
    .split(/[^\p{L}]/u)[0];
  if (!first || first.length < 4 || first.length > 9) return null;
  return distance(first, 'jarvis') <= 3 ? first : null;
}
