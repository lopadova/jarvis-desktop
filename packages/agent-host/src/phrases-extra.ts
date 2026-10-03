/** Sidecar-only phrases not (yet) in @jarvis/core `phrases` — EN + IT. */
import type { Locale } from '@jarvis/core';

const X = {
  en: {
    privateBlocked: (what: string) =>
      `Private mode is on, so I can't use ${what}: it would send data off this computer. Pick a local option or turn private mode off.`,
    privateNoBrain:
      'Private mode is on and no local brain is set up. Add a local model in settings, or turn private mode off.',
    cloudSttPrivate: 'Private mode is on, so cloud transcription is disabled.',
    sttFailed: "[sigh] I couldn't transcribe that. Try again?",
    interrupted: 'Interrupted when Jarvis restarted.',
    relayWriteRefused: 'This tool is disabled for remote clients. Enable write tools for the relay in Jarvis settings.',
    noAnswer: 'The user did not answer.',
    opened: 'Opened.',
    nothingToOpen: "There's nothing to open yet.",
    queued: "Got it, I'll pass that on as soon as it's free.",
    projectCreated: (p: string) => `I created the project ${p}.`,
    cancelled: 'Cancelled.',
    unknownSession: "I couldn't find that session.",
    mcpSpeakPrefix: '',
  },
  it: {
    privateBlocked: (what: string) =>
      `La modalità privata è attiva, quindi non posso usare ${what}: invierebbe dati fuori da questo computer. Scegli un’opzione locale o disattiva la modalità privata.`,
    privateNoBrain:
      'La modalità privata è attiva e non c’è un cervello locale configurato. Aggiungi un modello locale nelle impostazioni o disattiva la modalità privata.',
    cloudSttPrivate: 'La modalità privata è attiva, quindi la trascrizione nel cloud è disattivata.',
    sttFailed: '[sigh] Non sono riuscito a trascrivere. Riprovi?',
    interrupted: 'Interrotto al riavvio di Jarvis.',
    relayWriteRefused:
      'Questo strumento è disattivato per i client remoti. Abilita gli strumenti di scrittura per il relay nelle impostazioni di Jarvis.',
    noAnswer: 'L’utente non ha risposto.',
    opened: 'Aperto.',
    nothingToOpen: 'Non c’è ancora niente da aprire.',
    queued: 'Ok, glielo passo appena è libero.',
    projectCreated: (p: string) => `Ho creato il progetto ${p}.`,
    cancelled: 'Annullato.',
    unknownSession: 'Non trovo quella sessione.',
    mcpSpeakPrefix: '',
  },
} as const;

export type ExtraPhrases = (typeof X)['en'];
export const extraPhrases = (locale: Locale): ExtraPhrases => X[locale] as unknown as ExtraPhrases;
