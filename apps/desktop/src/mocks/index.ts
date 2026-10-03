/**
 * Typed mock data for every surface (EN + IT), mirroring the Claude Design handoff samples.
 * Used in mock mode (plain browser) and in tests.
 */
import { allSuggestions, defaultSettings, type Memory, type Project, type Reminder, type Settings } from '@jarvis/core';
import type {
  ApprovalRequest,
  ChatMessage,
  Locale,
  PillEvent,
  ProviderStatus,
  RelayState,
  SessionView,
  Suggestion,
} from '../types/ui';

const MIN = 60_000;

export interface MockSnapshot {
  settings: Settings;
  sessions: SessionView[];
  pending: ApprovalRequest[];
  providers: ProviderStatus[];
  reminders: Reminder[];
  chat: ChatMessage[];
  pill: PillEvent;
  relay: RelayState;
  suggestions: Suggestion[];
  version: string;
}

export const COPY = {
  en: {
    morning: 'Good morning, Lorenzo. 14° and clear. Three meetings today — the first is the pricing review at 9:30.',
    tasks: [
      'Compile competitor pricing for the Q4 briefing',
      'Draft the Q4 strategic briefing outline',
      'Update the Google Shopping product feed',
    ],
    activity: 'Reading 14 product pages',
    resultDone:
      'Six sections: market, pricing, channels, risks, roadmap, asks. Two open questions for Giulia are flagged.',
    resultFailed: 'Feed upload rejected: 3 products are missing a GTIN.',
    approval: {
      low: ['Edit a file', 'src/components/Footer.tsx', undefined],
      medium: [
        'Run a shell command',
        'pnpm add @radix-ui/react-separator',
        'The new footer uses a separator component that isn’t installed yet.',
      ],
      high: ['Delete a folder', 'rm -rf dist', 'Cleaning up before a fresh build.'],
    },
    weather: '14° · clear',
    events: [
      { time: '09:30', title: 'Pricing review — shop' },
      { time: '12:00', title: 'Lunch with Giulia' },
      { time: '16:00', title: 'Q4 strategic briefing' },
    ],
    emails: [
      { from: 'Giulia Romano', subject: 'Board deck — can you check slide 7?' },
      { from: 'Shopify', subject: '3 orders need fulfilment' },
    ],
    greeting: 'Jarvis, good morning',
    reminder: 'Call Marco',
    memories: [
      ['Prefers short answers', 'said', 2],
      ['Runs the shop e‑commerce and writes strategic briefings', 'inferred', 6],
      ['Morning meetings start at 9:30', 'inferred', 10],
      ['Giulia Romano is the board contact', 'said', 15],
    ],
  },
  it: {
    morning: 'Buongiorno, Lorenzo. 14° e sereno. Tre riunioni oggi — la prima è la revisione prezzi alle 9:30.',
    tasks: [
      'Raccogli i prezzi dei concorrenti per il briefing Q4',
      'Bozza della scaletta del briefing strategico Q4',
      'Aggiorna il feed prodotti Google Shopping',
    ],
    activity: 'Leggo 14 pagine prodotto',
    resultDone: 'Sei sezioni: mercato, prezzi, canali, rischi, roadmap, richieste. Segnalate due domande per Giulia.',
    resultFailed: 'Caricamento rifiutato: a 3 prodotti manca il GTIN.',
    approval: {
      low: ['Modifica un file', 'src/components/Footer.tsx', undefined],
      medium: [
        'Esegui un comando di shell',
        'pnpm add @radix-ui/react-separator',
        'Il nuovo footer usa un componente separatore non ancora installato.',
      ],
      high: ['Elimina una cartella', 'rm -rf dist', 'Pulizia prima di una build pulita.'],
    },
    weather: '14° · sereno',
    events: [
      { time: '09:30', title: 'Revisione prezzi — shop' },
      { time: '12:00', title: 'Pranzo con Giulia' },
      { time: '16:00', title: 'Briefing strategico Q4' },
    ],
    emails: [
      { from: 'Giulia Romano', subject: 'Deck del board — puoi guardare la slide 7?' },
      { from: 'Shopify', subject: '3 ordini da evadere' },
    ],
    greeting: 'Jarvis, buongiorno',
    reminder: 'Chiamare Marco',
    memories: [
      ['Preferisce risposte brevi', 'said', 2],
      ['Segue l’e‑commerce shop e scrive briefing strategici', 'inferred', 6],
      ['Le riunioni del mattino iniziano alle 9:30', 'inferred', 10],
      ['Giulia Romano è la referente del board', 'said', 15],
    ],
  },
} as const;

export function mockApproval(
  locale: Locale,
  risk: ApprovalRequest['risk'] = 'medium',
  now = Date.now(),
): ApprovalRequest {
  const [title, detail, reason] = COPY[locale].approval[risk];
  return {
    id: `appr-${risk}`,
    sessionId: 's-run',
    kind: risk === 'high' ? 'file-delete' : risk === 'low' ? 'file-write' : 'shell',
    risk,
    title,
    detail,
    cwd: '~/code/shop',
    agent: risk === 'low' ? 'codex' : 'claude',
    project: 'shop',
    ...(reason ? { reason } : {}),
    ...(risk === 'medium' ? { expiresAt: now + 42_000 } : {}),
  };
}

export function mockSessions(locale: Locale, now = Date.now()): SessionView[] {
  const c = COPY[locale];
  return [
    {
      id: 's-run',
      agent: 'home',
      project: 'strategy-briefs',
      task: c.tasks[0],
      status: 'running',
      activity: c.activity,
      startedAt: now - 6 * MIN,
    },
    {
      id: 's-done',
      agent: 'claude',
      project: 'strategy-briefs',
      task: c.tasks[1],
      status: 'done',
      startedAt: now - 26 * MIN,
      finishedAt: now - 18 * MIN,
      resultPreview: c.resultDone,
      resultUrl: 'file:///Users/lorenzo/Documents/strategy-briefs/q4-outline.md',
    },
    {
      id: 's-fail',
      agent: 'codex',
      project: 'shop',
      task: c.tasks[2],
      status: 'failed',
      startedAt: now - 95 * MIN,
      finishedAt: now - 88 * MIN,
      resultPreview: c.resultFailed,
    },
  ];
}

export function mockProviders(): ProviderStatus[] {
  return [
    {
      id: 'chatgpt',
      connected: true,
      account: 'lorenzo@example.com',
      plan: 'ChatGPT Plus',
      usagePct: 12,
      state: 'ok',
      primary: true,
    },
    {
      id: 'claude',
      connected: true,
      account: 'lorenzo@example.com',
      plan: 'Claude Max',
      usagePct: 84,
      state: 'ok',
      primary: false,
    },
    { id: 'codex', connected: true, account: 'via ChatGPT Plus', usagePct: 100, state: 'cap-reached', primary: false },
    { id: 'api-anthropic', connected: false, state: 'not-installed', primary: false },
    { id: 'local', connected: true, plan: 'llama3.2 · 3B', state: 'ok', primary: false },
  ];
}

export function mockChat(locale: Locale, now = Date.now()): ChatMessage[] {
  const c = COPY[locale];
  const [, done] = mockSessions(locale, now);
  return [
    { id: 'm1', role: 'user', text: c.greeting, at: now - 52 * MIN, viaVoice: true },
    { id: 'm2', role: 'jarvis', text: c.morning, at: now - 52 * MIN + 4000, spoken: true },
    {
      id: 'm3',
      role: 'system',
      card: { type: 'briefing', weather: c.weather, events: [...c.events], emails: [...c.emails] },
      at: now - 52 * MIN + 5000,
    },
    { id: 'm4', role: 'system', card: { type: 'result-ready', session: done as SessionView }, at: now - 18 * MIN },
  ];
}

export function mockMemories(locale: Locale, now = Date.now()): Memory[] {
  return COPY[locale].memories.map(([text, source, daysAgo], i) => ({
    id: `mem-${i + 1}`,
    text,
    source,
    createdAt: now - daysAgo * 86_400_000,
  }));
}

export function mockProjects(): Project[] {
  const p = (
    id: string,
    name: string,
    path: string,
    permission: Project['permission'],
    defaultAgent: Project['defaultAgent'],
  ) => ({
    id,
    name,
    path,
    aliases: [],
    defaultAgent,
    permission,
    allowlist: [],
  });
  return [
    p('p-shop', 'shop', '~/code/shop', 'trusted', 'claude'),
    p('p-briefs', 'strategy-briefs', '~/Documents/strategy-briefs', 'safe', 'home'),
  ];
}

export function mockSnapshot(locale: Locale = 'en', now = Date.now()): MockSnapshot {
  const settings: Settings = {
    ...defaultSettings(),
    locale,
    userName: 'Lorenzo',
    onboardingComplete: true,
    theme: 'dark',
    material: 'glass',
    primaryBrain: 'chatgpt',
  };
  return {
    settings,
    sessions: mockSessions(locale, now),
    pending: [],
    providers: mockProviders(),
    reminders: [{ id: 'r1', text: COPY[locale].reminder, dueAt: now + 20 * MIN, kind: 'reminder', done: false }],
    chat: mockChat(locale, now),
    pill: { state: { kind: 'idle-hint', shortcut: ['Alt', 'Space'] }, privateMode: false },
    relay: { status: 'unpaired' },
    suggestions: allSuggestions(locale),
    version: '0.1.0-mock',
  };
}
