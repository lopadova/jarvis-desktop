import type { Locale } from './model.js';

/** Fixed spoken/displayed phrases produced without an LLM. */
const P = {
  en: {
    nothingRunning: "Nothing's running right now.",
    stopped: 'Stopped.',
    stoppedAll: 'Okay, I stopped everything.',
    timerSet: (d: string) => `Timer set for ${d}.`,
    alarmSet: (t: string) => `Alarm set for ${t}.`,
    reminderSet: (d: string, what: string) => `Okay, in ${d} I'll remind you to ${what}.`,
    reminderFire: (what: string) => `[calm] Reminder: ${what}.`,
    timerFire: (label: string) => (label ? `[happy] Your ${label} timer is done.` : '[happy] Time is up!'),
    alarmFire: '[happy] Good morning! This is your alarm.',
    time: (t: string) => `It's ${t}.`,
    date: (d: string) => `Today is ${d}.`,
    privateOn: 'Private mode on. Everything stays on this computer.',
    privateOff: 'Private mode off.',
    nothingToRepeat: "I haven't said anything yet.",
    noBrain:
      "I don't have a brain connected yet. Open settings and sign in with ChatGPT, Claude Code, or add an API key.",
    capReached: (p: string) =>
      `[sigh] Your ${p} weekly allowance for Jarvis is used up. I won't switch to paid API on my own — you can pick another brain in settings.`,
    needsLogin: (p: string) => `I need you to sign in to ${p} again.`,
    brainError: "[sigh] Sorry, I couldn't work that out. Try again?",
    tooManySessions: (n: number) => `I already have ${n} things running. Let's wait for one to finish.`,
    whichProject: 'Which project?',
    whatShouldItDo: 'What should it do?',
    notGrounded: 'Just to be sure — what exactly do you want me to do?',
    started: (p: string) => `On it, working on ${p}.`,
    noAgent:
      "I can't start that: no agent is available. Install Claude Code or Codex, or enable the Home agent in settings.",
    agentMissing: (a: string) => `${a} isn't installed or isn't signed in.`,
    folderMissing: (p: string) => `The folder for ${p} doesn't exist. Fix the path in settings.`,
    progress: (elapsed: string, doing: string) => `${elapsed} in, ${doing}.`,
    approvalVoice: (title: string) => `I need your OK to ${title}. Say yes or no.`,
    approvalClick: (title: string) => `I need your OK to ${title}. Please confirm on screen.`,
    approvalDenied: "Okay, I won't.",
    approvalExpired: 'No answer, so I declined.',
    remembered: "Got it, I'll remember that.",
    forgotten: 'Done, forgotten.',
    sessionDone: (p: string) => `${p} is done.`,
    sessionFailed: (p: string) => `${p} didn't work out, have a look at the log.`,
    dictationOn: "Dictation on. Go ahead, I'll type what you say.",
    dictationCancelled: 'Dictation cancelled.',
    dictationIdle: "I'm not taking dictation right now.",
    dictationNoShell: "I can't type into other apps right now.",
    clipboardEmpty: 'Your clipboard is empty. Copy some text first.',
    clipboardUnavailable: "I can't read the clipboard right now.",
    nothingToCopy: "There's nothing to copy yet.",
    copied: 'Copied to the clipboard.',
    screenOff: 'Screen access is off. Turn on Screen access in Settings, under Privacy, and ask me again.',
    screenNoVision: (b: string) =>
      `${b} can't look at images. Connect ChatGPT or a local vision model, or pick an API brain, in settings.`,
    screenFailed: "I couldn't capture the screen.",
    shoppingAdded: (items: string) => `Added ${items} to the shopping list.`,
    shoppingAlready: (items: string) => `${items} ${/ and /.test(items) ? 'are' : 'is'} already on the list.`,
    shoppingRemoved: (items: string) => `Removed ${items} from the shopping list.`,
    shoppingNotFound: (items: string) => `I couldn't find ${items} on the shopping list.`,
    shoppingEmpty: 'The shopping list is empty.',
    shoppingList: (n: number, items: string) =>
      n === 1 ? `One thing on the shopping list: ${items}.` : `${n} things on the shopping list: ${items}.`,
    shoppingCleared: 'Shopping list cleared.',
    todayForgotten: "Done. I deleted today's history.",
    memoryNone: "I don't know anything about you yet. Tell me, for example: remember that I prefer short answers.",
    memorySummary: (n: number, items: string, more: number) =>
      `${n === 1 ? 'I remember one thing about you' : `I remember ${n} things about you`}: ${items}.${
        more ? ` And ${more} more.` : ''
      } You can review them in the Memory view.`,
    briefingStarted: '[happy] Good morning! Let me put your briefing together.',
    and: 'and',
  },
  it: {
    nothingRunning: 'Al momento non c’è niente in corso.',
    stopped: 'Fermato.',
    stoppedAll: 'Ok, ho fermato tutto.',
    timerSet: (d: string) => `Timer di ${d} avviato.`,
    alarmSet: (t: string) => `Sveglia impostata per le ${t}.`,
    reminderSet: (d: string, what: string) => `Ok, tra ${d} ti ricordo di ${what}.`,
    reminderFire: (what: string) => `[calm] Promemoria: ${what}.`,
    timerFire: (label: string) => (label ? `[happy] Il timer ${label} è finito.` : '[happy] Tempo scaduto!'),
    alarmFire: '[happy] Buongiorno! È l’ora della sveglia.',
    time: (t: string) => `Sono le ${t}.`,
    date: (d: string) => `Oggi è ${d}.`,
    privateOn: 'Modalità privata attiva. Tutto resta su questo computer.',
    privateOff: 'Modalità privata disattivata.',
    nothingToRepeat: 'Non ho ancora detto niente.',
    noBrain:
      'Non ho ancora un cervello collegato. Apri le impostazioni e accedi con ChatGPT, Claude Code o aggiungi una chiave API.',
    capReached: (p: string) =>
      `[sigh] Hai finito la quota settimanale di ${p} per Jarvis. Non passo da solo alle API a pagamento: puoi scegliere un altro cervello nelle impostazioni.`,
    needsLogin: (p: string) => `Devi rifare l’accesso a ${p}.`,
    brainError: '[sigh] Scusa, non sono riuscito a capirla. Riprovi?',
    tooManySessions: (n: number) => `Ho già ${n} lavori in corso. Aspettiamo che uno finisca.`,
    whichProject: 'Su quale progetto?',
    whatShouldItDo: 'Cosa deve fare?',
    notGrounded: 'Per sicurezza: cosa vuoi esattamente che faccia?',
    started: (p: string) => `Ci penso io, parto su ${p}.`,
    noAgent:
      'Non posso avviarlo: nessun agente disponibile. Installa Claude Code o Codex, oppure attiva l’agente Casa nelle impostazioni.',
    agentMissing: (a: string) => `${a} non è installato o non ha fatto l’accesso.`,
    folderMissing: (p: string) => `La cartella di ${p} non esiste. Correggi il percorso nelle impostazioni.`,
    progress: (elapsed: string, doing: string) => `Sono a ${elapsed}, ${doing}.`,
    approvalVoice: (title: string) => `Mi serve il tuo ok per ${title}. Dimmi sì o no.`,
    approvalClick: (title: string) => `Mi serve il tuo ok per ${title}. Conferma sullo schermo.`,
    approvalDenied: 'Ok, non lo faccio.',
    approvalExpired: 'Nessuna risposta, quindi ho rifiutato.',
    remembered: 'Ok, me lo ricordo.',
    forgotten: 'Fatto, dimenticato.',
    sessionDone: (p: string) => `${p} è pronto.`,
    sessionFailed: (p: string) => `${p} non è andato a buon fine, guarda il log.`,
    dictationOn: 'Dettatura attiva. Parla pure, scrivo io.',
    dictationCancelled: 'Dettatura annullata.',
    dictationIdle: 'Al momento non sto prendendo dettatura.',
    dictationNoShell: 'Al momento non riesco a scrivere nelle altre app.',
    clipboardEmpty: 'Gli appunti sono vuoti. Copia prima un testo.',
    clipboardUnavailable: 'Al momento non riesco a leggere gli appunti.',
    nothingToCopy: 'Non c’è ancora niente da copiare.',
    copied: 'Copiato negli appunti.',
    screenOff:
      'L’accesso allo schermo è disattivato. Attivalo nelle Impostazioni, sezione Privacy, e chiedimelo di nuovo.',
    screenNoVision: (b: string) =>
      `${b} non può guardare le immagini. Collega ChatGPT o un modello locale con visione, oppure scegli un cervello API, nelle impostazioni.`,
    screenFailed: 'Non sono riuscito a catturare lo schermo.',
    shoppingAdded: (items: string) => `Ho aggiunto ${items} alla lista della spesa.`,
    shoppingAlready: (items: string) => `${items} ${/ e /.test(items) ? 'ci sono' : 'c’è'} già nella lista.`,
    shoppingRemoved: (items: string) => `Ho tolto ${items} dalla lista della spesa.`,
    shoppingNotFound: (items: string) => `Non trovo ${items} nella lista della spesa.`,
    shoppingEmpty: 'La lista della spesa è vuota.',
    shoppingList: (n: number, items: string) =>
      n === 1
        ? `Nella lista della spesa c’è una cosa: ${items}.`
        : `Nella lista della spesa ci sono ${n} cose: ${items}.`,
    shoppingCleared: 'Lista della spesa svuotata.',
    todayForgotten: 'Fatto. Ho cancellato la cronologia di oggi.',
    memoryNone: 'Non so ancora niente di te. Dimmi per esempio: ricordati che preferisco risposte brevi.',
    memorySummary: (n: number, items: string, more: number) =>
      `${n === 1 ? 'Di te ricordo una cosa' : `Di te ricordo ${n} cose`}: ${items}.${
        more ? ` E altre ${more}.` : ''
      } Le trovi nella vista Memoria.`,
    briefingStarted: '[happy] Buongiorno! Preparo il tuo briefing.',
    and: 'e',
  },
} as const;

export type Phrases = (typeof P)['en'];
export const phrases = (locale: Locale): Phrases => P[locale] as unknown as Phrases;

/** "milk", "milk and eggs", "milk, eggs and bread" / Italian "latte, uova e pane". */
export function spokenList(items: string[], locale: Locale): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ${phrases(locale).and} ${items.at(-1)}`;
}

/** Spoken duration: "40 seconds", "3 minutes", "1 hour and 5 minutes" / Italian equivalents. */
export function spokenDuration(seconds: number, locale: Locale): string {
  const s = Math.max(0, Math.round(seconds));
  const it = locale === 'it';
  if (s < 60) return it ? `${s} secondi` : `${s} seconds`;
  const m = Math.floor(s / 60);
  if (s < 3600) return it ? (m === 1 ? 'un minuto' : `${m} minuti`) : m === 1 ? 'one minute' : `${m} minutes`;
  const h = Math.floor(s / 3600);
  const rm = Math.floor((s % 3600) / 60);
  const hs = it ? (h === 1 ? 'un’ora' : `${h} ore`) : h === 1 ? 'one hour' : `${h} hours`;
  if (!rm) return hs;
  return it ? `${hs} e ${rm} minuti` : `${hs} and ${rm} minutes`;
}

/** Yes/no recognition for voice approvals (only ever used for low/medium risk). */
export function parseYesNo(text: string): 'yes' | 'no' | null {
  const t = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\s]/gu, ' ')
    .trim();
  if (
    /^(yes|yeah|yep|sure|ok|okay|go ahead|do it|allow|si|certo|vai|procedi|ok vai|fallo|consenti|va bene)( please| pure)?$/.test(
      t,
    )
  )
    return 'yes';
  if (/^(no|nope|don ?t|do not|deny|stop|cancel|non farlo|annulla|nega|lascia stare|ferma)( please| grazie)?$/.test(t))
    return 'no';
  return null;
}
