# Voice commands (fast path)

These commands are recognised **on your computer without any AI model**: they answer in a fraction of a second, work offline and cost nothing. Everything else goes to your brain, which understands free-form requests.

The leading wake word is optional in the text ("Jarvis", "hey Jarvis", "ok Jarvis", Italian "ehi Jarvis"). Matching ignores case, accents and punctuation. Source: [`packages/core/src/router/fastpath.ts`](../../packages/core/src/router/fastpath.ts).

## Control

| Intent | English | Italian |
|---|---|---|
| Stop speaking | "stop", "quiet", "be quiet", "shut up" | "basta", "zitto", "silenzio", "fermati", "ferma" |
| Cancel all sessions | "stop everything", "cancel all", "stop all" | "ferma tutto", "annulla tutto", "interrompi tutte le sessioni" |
| Status | "status", "how's it going?", "what's running?" | "a che punto sei?", "a che punto siamo?", "come sta andando?", "come va il lavoro?", "cosa sta girando?", "stato" |
| Repeat | "repeat", "say that again", "say it again" | "ripeti", "puoi ripetere", "come hai detto" |
| Open settings | "open settings", "settings" | "apri le impostazioni", "impostazioni" |

## Time and date

| Intent | English | Italian |
|---|---|---|
| Time | "what time is it", "what's the time" | "che ore sono", "che ora è" |
| Date | "what's the date", "what day is it", "what day is today" | "che giorno è oggi", "che data è oggi" |

## Private mode

| Intent | English | Italian |
|---|---|---|
| On | "switch to local mode", "private mode", "local mode" | "passa alla modalità locale", "modalità privata", "tutto in locale" |
| Off | "private mode off", "turn off local mode", "exit private mode", "disable local mode" | "disattiva la modalità privata", "esci dalla modalità locale", "spegni la modalità privata" |

## Timers

Say "timer" (or "countdown" / "conto alla rovescia") with a duration.

| English | Italian |
|---|---|
| "timer for 10 minutes" | "timer di 10 minuti" |
| "set a timer for five minutes" | "metti un timer di cinque minuti" |
| "timer 1h 30m" | "timer di un'ora e mezza" |
| "countdown 90 seconds" | "conto alla rovescia 90 secondi" |
| "timer for half an hour" | "timer di mezz'ora" |

Numbers can be digits or words (one…sixty; uno…quaranta). Units: seconds, minutes, hours (`s`, `min`, `h`, `secondi`, `minuti`, `ore`…). "and a half" / "e mezza" adds half an hour (or 30 s for minutes).

## Alarms

Say "alarm", "wake me up", "sveglia" or "svegliami" with a time.

| English | Italian |
|---|---|
| "alarm at 7:30" | "sveglia alle 7:30" |
| "wake me up at 6 am" | "svegliami alle 6" |
| "alarm at 7:45 pm" | "sveglia alle 7 e 45" |

## Reminders (relative)

Pattern: *remind me in {duration} to {what}* / *ricordami tra (fra) {durata} di {cosa}*.

| English | Italian |
|---|---|
| "remind me in 20 minutes to call Marco" | "ricordami tra 20 minuti di chiamare Marco" |
| "remind me in an hour to take the pizza out" | "ricordami fra un'ora di togliere la pizza" |

Reminders at an absolute time ("remind me tomorrow at 9 to…") are handled by the brain, which creates the same kind of local reminder.

## Approval answers

When an approval card asks for your OK (low and medium risk only — high risk always requires a click):

| Answer | English | Italian |
|---|---|---|
| **Yes** | "yes", "yeah", "yep", "sure", "ok", "okay", "go ahead", "do it", "allow" (optionally + "please") | "sì", "certo", "vai", "procedi", "ok vai", "fallo", "consenti", "va bene" (optionally + "pure") |
| **No** | "no", "nope", "don't", "do not", "deny", "stop", "cancel" (optionally + "please") | "no", "non farlo", "annulla", "nega", "lascia stare", "ferma" (optionally + "grazie") |

Anything else is not taken as an answer — Jarvis keeps waiting, and the request is denied when it times out.

## Spoken confirmations

Fast-path replies are fixed phrases, for example "Timer set for 10 minutes.", "Alarm set for 7:30.", "Okay, in 20 minutes I'll remind you to call Marco.", "Private mode on. Everything stays on this computer." (Italian equivalents when `locale` is `it`).
