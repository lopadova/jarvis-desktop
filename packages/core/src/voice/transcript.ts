/**
 * Whisper prints bracketed tags for silence and noise ("[BLANK_AUDIO]", "(silence)", "[Music]", "*sighs*", "♪").
 * A transcript made only of those is not speech and must never become a turn for the brain.
 */
export function isNonSpeech(text: string): boolean {
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
