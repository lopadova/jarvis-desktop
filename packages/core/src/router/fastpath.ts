/**
 * Deterministic intents handled without an LLM: near-zero latency, work offline, cost nothing.
 * Supports English and Italian phrasing.
 */

export type FastIntent =
  | { kind: 'stop-speaking' }
  | { kind: 'cancel-all' }
  | { kind: 'status' }
  | { kind: 'repeat' }
  | { kind: 'timer'; seconds: number; label: string }
  | { kind: 'alarm'; at: { hour: number; minute: number } }
  | { kind: 'reminder'; inSeconds: number; text: string }
  | { kind: 'time' }
  | { kind: 'date' }
  | { kind: 'private-mode'; on: boolean }
  | { kind: 'open-settings' };

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}:\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(hey |ok |ehi )?(jarvis|giarvis|jervis)\s*/, '');

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fortyfive: 45,
  sixty: 60,
  a: 1,
  an: 1,
  half: 0.5,
  uno: 1,
  un: 1,
  una: 1,
  due: 2,
  tre: 3,
  quattro: 4,
  cinque: 5,
  sei: 6,
  sette: 7,
  otto: 8,
  nove: 9,
  dieci: 10,
  quindici: 15,
  venti: 20,
  trenta: 30,
  quaranta: 40,
  mezzo: 0.5,
  mezz: 0.5,
  mezza: 0.5,
};

const UNIT_SECONDS: [RegExp, number][] = [
  [/^(s|sec|secs|second|seconds|secondo|secondi)$/, 1],
  [/^(m|min|mins|minute|minutes|minuto|minuti)$/, 60],
  [/^(h|hr|hrs|hour|hours|ora|ore)$/, 3600],
];

function parseDuration(text: string): number | null {
  // "10 minutes", "un'ora e mezza", "1h 30m", "venti minuti", "half an hour", "mezz'ora"
  const t = text.replace(/'/g, ' ');
  if (/\b(half an hour|mezz ora|mezzora|mezza ora)\b/.test(t)) return 1800;
  let total = 0;
  let matched = false;
  const re =
    /(\d+(?:[.,]\d+)?|[a-z]+)\s*(s|sec|secs|seconds?|secondo|secondi|m|min|mins|minutes?|minuto|minuti|h|hr|hrs|hours?|ora|ore)\b/g;
  for (const m of t.matchAll(re)) {
    const rawN = m[1] ?? '';
    const n = /^\d/.test(rawN) ? Number(rawN.replace(',', '.')) : NUMBER_WORDS[rawN];
    if (n === undefined || Number.isNaN(n)) continue;
    const unit = UNIT_SECONDS.find(([r]) => r.test(m[2] ?? ''));
    if (!unit) continue;
    total += n * unit[1];
    matched = true;
  }
  if (matched && /\b(e mezza|e mezzo|and a half)\b/.test(t)) {
    if (/\b(ora|ore|hour|hours)\b/.test(t)) total += 1800;
    else if (/\b(minut)/.test(t)) total += 30;
  }
  return matched && total > 0 ? Math.round(total) : null;
}

function parseClock(text: string): { hour: number; minute: number } | null {
  const m = text.match(/\b(?:at|alle|per le|a las)?\s*(\d{1,2})(?:[:.](\d{2})| e (\d{1,2}))?\s*(am|pm)?\b/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? m[3] ?? 0);
  if (m[4] === 'pm' && hour < 12) hour += 12;
  if (m[4] === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function matchFastIntent(utterance: string): FastIntent | null {
  const t = norm(utterance);
  if (!t) return null;

  if (/^(stop|basta|zitto|silenzio|shut up|quiet|be quiet|fermati|ferma)$/.test(t)) return { kind: 'stop-speaking' };
  if (/^(stop|cancel|ferma|annulla|interrompi) (everything|all|tutto|tutte|tutti)( le sessioni)?$/.test(t)) {
    return { kind: 'cancel-all' };
  }
  if (
    /^(status|how'?s it going|how is it going|what'?s running|a che punto (sei|siamo)|come (sta andando|va il lavoro)|cosa sta girando|stato)\??$/.test(
      t,
    )
  ) {
    return { kind: 'status' };
  }
  if (/^(repeat|say (that|it) again|ripeti|puoi ripetere|come hai detto)$/.test(t)) return { kind: 'repeat' };
  if (/^(what time is it|what'?s the time|che ore sono|che ora e|che ora è)$/.test(t)) return { kind: 'time' };
  if (/^(what'?s the date|what day is (it|today)|che giorno e( oggi)?|che data e( oggi)?)$/.test(t))
    return { kind: 'date' };
  if (/^(open settings|apri (le )?impostazioni|settings|impostazioni)$/.test(t)) return { kind: 'open-settings' };
  if (/\b(local|private) mode\b|\bmodalita (locale|privata)\b|\btutto in locale\b/.test(t)) {
    const off = /\b(off|disable|turn off|exit|esci|disattiva|spegni)\b/.test(t);
    return { kind: 'private-mode', on: !off };
  }

  // Timers: "timer 10 minuti", "set a timer for 5 minutes", "metti un timer di un'ora"
  if (/\b(timer|countdown|conto alla rovescia)\b/.test(t)) {
    const seconds = parseDuration(t);
    if (seconds) {
      const label = t.match(/\b(?:for|per)\s+(?:the\s+|la\s+|il\s+)?([a-z]+(?: [a-z]+)?)$/)?.[1] ?? '';
      return { kind: 'timer', seconds, label: /\d|minut|second|hour|ora|ore/.test(label) ? '' : label };
    }
  }
  // Alarms: "wake me up at 7:30", "sveglia alle 7 e 30"
  if (/\b(alarm|wake me( up)?|sveglia|svegliami)\b/.test(t)) {
    const at = parseClock(t);
    if (at) return { kind: 'alarm', at };
  }
  // Reminders: "remind me in 20 minutes to call Marco", "ricordami tra 20 minuti di chiamare Marco"
  const rem = t.match(/^(?:remind me|ricordami)\s+(?:in|tra|fra)\s+(.+?)\s+(?:to|that|di|che|a)\s+(.+)$/);
  if (rem) {
    const seconds = parseDuration(rem[1] ?? '');
    if (seconds && rem[2]) return { kind: 'reminder', inSeconds: seconds, text: rem[2] };
  }
  return null;
}
