import { describe, expect, it } from 'vitest';
import { matchContentSource, matchFastIntent, parseYesNo } from '../src/index.js';

/**
 * Every phrase listed in docs/reference/voice-commands.md (and its docs-site copy).
 * If this test fails, either the matcher regressed or the docs promise a phrase that doesn't work:
 * fix one of the two, keeping them in sync.
 */
const DOCUMENTED: [string, string][] = [
  // Control
  ...['stop', 'quiet', 'be quiet', 'shut up', 'basta', 'zitto', 'silenzio', 'fermati', 'ferma'].map(
    (p) => [p, 'stop-speaking'] as [string, string],
  ),
  ...['stop everything', 'cancel all', 'stop all', 'ferma tutto', 'annulla tutto', 'interrompi tutte le sessioni'].map(
    (p) => [p, 'cancel-all'] as [string, string],
  ),
  ...[
    'status',
    "how's it going?",
    "what's running?",
    'a che punto sei?',
    'a che punto siamo?',
    'come sta andando?',
    'come va il lavoro?',
    'cosa sta girando?',
    'stato',
  ].map((p) => [p, 'status'] as [string, string]),
  ...['repeat', 'say that again', 'say it again', 'ripeti', 'puoi ripetere', 'come hai detto'].map(
    (p) => [p, 'repeat'] as [string, string],
  ),
  ...['open settings', 'settings', 'apri le impostazioni', 'impostazioni'].map(
    (p) => [p, 'open-settings'] as [string, string],
  ),
  // Time and date
  ...['what time is it', "what's the time", 'che ore sono', 'che ora è'].map((p) => [p, 'time'] as [string, string]),
  ...["what's the date", 'what day is it', 'what day is today', 'che giorno è oggi', 'che data è oggi'].map(
    (p) => [p, 'date'] as [string, string],
  ),
  // Private mode
  ...[
    'switch to local mode',
    'private mode',
    'local mode',
    'passa alla modalità locale',
    'modalità privata',
    'tutto in locale',
    'private mode off',
    'turn off local mode',
    'exit private mode',
    'disable local mode',
    'disattiva la modalità privata',
    'esci dalla modalità locale',
    'spegni la modalità privata',
  ].map((p) => [p, 'private-mode'] as [string, string]),
  // Timers
  ...[
    'timer for 10 minutes',
    'set a timer for five minutes',
    'timer 1h 30m',
    'countdown 90 seconds',
    'timer for half an hour',
    'timer di 10 minuti',
    'metti un timer di cinque minuti',
    "timer di un'ora e mezza",
    'conto alla rovescia 90 secondi',
    "timer di mezz'ora",
  ].map((p) => [p, 'timer'] as [string, string]),
  // Alarms
  ...[
    'alarm at 7:30',
    'wake me up at 6 am',
    'alarm at 7:45 pm',
    'sveglia alle 7:30',
    'svegliami alle 6',
    'sveglia alle 7 e 45',
  ].map((p) => [p, 'alarm'] as [string, string]),
  // Reminders
  ...[
    'remind me in 20 minutes to call Marco',
    'remind me in an hour to take the pizza out',
    'ricordami tra 20 minuti di chiamare Marco',
    "ricordami fra un'ora di togliere la pizza",
  ].map((p) => [p, 'reminder'] as [string, string]),
  // Everyday
  ...['good morning', 'morning', 'buongiorno', 'buon giorno'].map((p) => [p, 'briefing'] as [string, string]),
  ...[
    'dictate',
    'dictation',
    'start dictation',
    'take dictation',
    'type what I say',
    'dettatura',
    'detta',
    'avvia la dettatura',
    'inizia la dettatura',
    'scrivi sotto dettatura',
  ].map((p) => [p, 'dictate'] as [string, string]),
  ...[
    'stop dictation',
    'cancel dictation',
    'end dictation',
    'fine dettatura',
    'stop dettatura',
    'annulla la dettatura',
    'basta dettatura',
  ].map((p) => [p, 'dictate-stop'] as [string, string]),
  ...['what do you know about me', 'what do you remember about me', 'cosa sai di me', 'cosa ricordi di me'].map(
    (p) => [p, 'what-you-know'] as [string, string],
  ),
  ...[
    "delete today's history",
    "clear today's history",
    'forget today',
    'cancella la cronologia di oggi',
    'elimina la cronologia di oggi',
    'dimentica oggi',
  ].map((p) => [p, 'forget-today'] as [string, string]),
  ...['copy it', 'copy that', 'copy the result', 'copialo', 'copiala', 'copia il risultato'].map(
    (p) => [p, 'copy-result'] as [string, string],
  ),
  // Shopping list
  ...[
    'add milk and eggs to the shopping list',
    'put bread on my shopping list',
    'aggiungi il latte e le uova alla lista della spesa',
    'metti il pane nella lista della spesa',
  ].map((p) => [p, 'shopping-add'] as [string, string]),
  ...[
    'remove eggs from the shopping list',
    'take bread off the shopping list',
    'togli le uova dalla lista della spesa',
    'rimuovi il pane dalla lista della spesa',
  ].map((p) => [p, 'shopping-remove'] as [string, string]),
  ...[
    "what's on the shopping list",
    'read me the shopping list',
    'shopping list',
    "cosa c'è nella lista della spesa",
    'leggimi la lista della spesa',
    'lista della spesa',
  ].map((p) => [p, 'shopping-list'] as [string, string]),
  ...[
    'clear the shopping list',
    'empty my shopping list',
    'svuota la lista della spesa',
    'azzera la lista della spesa',
  ].map((p) => [p, 'shopping-clear'] as [string, string]),
];

describe('documented voice commands', () => {
  it.each(DOCUMENTED)('"%s" → %s', (phrase, kind) => {
    expect(matchFastIntent(phrase)?.kind).toBe(kind);
    expect(matchFastIntent(`Hey Jarvis, ${phrase}`)?.kind).toBe(kind);
  });

  it.each([
    ['private mode', true],
    ['tutto in locale', true],
    ['private mode off', false],
    ['turn off local mode', false],
    ['spegni la modalità privata', false],
  ] as const)('private mode "%s" → on=%s', (phrase, on) => {
    expect(matchFastIntent(phrase)).toEqual({ kind: 'private-mode', on });
  });

  it.each([
    ['timer 1h 30m', 5400],
    ["timer di un'ora e mezza", 5400],
    ['timer for half an hour', 1800],
    ["timer di mezz'ora", 1800],
    ['countdown 90 seconds', 90],
  ])('timer "%s" → %ds', (phrase, seconds) => {
    expect(matchFastIntent(phrase)).toMatchObject({ kind: 'timer', seconds });
  });

  it.each([
    ['alarm at 7:45 pm', { hour: 19, minute: 45 }],
    ['sveglia alle 7 e 45', { hour: 7, minute: 45 }],
    ['wake me up at 6 am', { hour: 6, minute: 0 }],
  ])('alarm "%s"', (phrase, at) => {
    expect(matchFastIntent(phrase)).toEqual({ kind: 'alarm', at });
  });

  it.each([
    ...[
      'yes',
      'yeah',
      'yep',
      'sure',
      'ok',
      'okay',
      'go ahead',
      'do it',
      'allow',
      'yes please',
      'sì',
      'certo',
      'vai',
      'procedi',
      'ok vai',
      'fallo',
      'consenti',
      'va bene',
      'vai pure',
    ].map((p) => [p, 'yes'] as [string, string]),
    ...[
      'no',
      'nope',
      "don't",
      'do not',
      'deny',
      'stop',
      'cancel',
      'no please',
      'non farlo',
      'annulla',
      'nega',
      'lascia stare',
      'ferma',
      'no grazie',
    ].map((p) => [p, 'no'] as [string, string]),
  ])('approval answer "%s" → %s', (phrase, answer) => {
    expect(parseYesNo(phrase)).toBe(answer);
  });

  it.each(
    [
      ['summarise what I copied', 'clipboard'],
      ['traduci gli appunti', 'clipboard'],
      ["what's on my screen?", 'screen'],
      ['take a screenshot and explain it', 'screen'],
      'what am I looking at',
      ['cosa vedo sullo schermo', 'screen'],
      ['cosa sto guardando', 'screen'],
      ['explain this error', 'screen'],
      ['spiegami questo errore', 'screen'],
    ].map((x) => (typeof x === 'string' ? [x, 'screen'] : x)),
  )('content source "%s" → %s', (phrase, source) => {
    expect(matchContentSource(phrase)).toBe(source);
  });
});
