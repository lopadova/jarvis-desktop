/** Typed mock data for every surface (EN + IT). Used in mock mode (plain browser) and in tests. */
import { allSuggestions, defaultSettings, type Reminder, type Settings } from '@jarvis/core';
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

const COPY = {
  en: {
    tasks: ['Add a footer to the shop homepage', 'Summarise my unread emails', 'Fix the failing checkout test'],
    activity: ['Editing Footer.tsx', 'Reading 12 messages', 'Running pnpm test'],
    result: 'Added a responsive footer with links and newsletter form. Preview at localhost:5173.',
    approvalTitle: 'Run a shell command',
    deleteTitle: 'Delete a folder',
    reason: 'Clean the build output before a fresh build.',
    user: 'What time is it?',
    jarvis: "It's 9:41. You have a meeting with Giulia at 10:30.",
    reminder: 'Call Marco',
  },
  it: {
    tasks: ['Aggiungi un footer alla home dello shop', 'Riassumi le email non lette', 'Sistema il test del checkout'],
    activity: ['Modifica di Footer.tsx', 'Lettura di 12 messaggi', 'Esecuzione di pnpm test'],
    result: 'Aggiunto un footer responsive con link e form newsletter. Anteprima su localhost:5173.',
    approvalTitle: 'Esegui un comando shell',
    deleteTitle: 'Elimina una cartella',
    reason: 'Pulisce la cartella di build prima di una build nuova.',
    user: 'Che ore sono?',
    jarvis: 'Sono le 9:41. Alle 10:30 hai una riunione con Giulia.',
    reminder: 'Chiamare Marco',
  },
} as const;

export function mockApproval(locale: Locale, risk: ApprovalRequest['risk'] = 'medium', now = Date.now()): ApprovalRequest {
  const c = COPY[locale];
  const high = risk === 'high';
  return {
    id: `appr-${risk}`,
    sessionId: 's1',
    kind: high ? 'file-delete' : 'shell',
    risk,
    title: high ? c.deleteTitle : c.approvalTitle,
    detail: high ? 'rm -rf ~/Projects/shop/dist' : 'pnpm build',
    cwd: '~/Projects/shop',
    agent: 'claude',
    project: 'shop',
    reason: c.reason,
    expiresAt: now + 2 * MIN,
  };
}

export function mockSessions(locale: Locale, now = Date.now()): SessionView[] {
  const c = COPY[locale];
  return [
    {
      id: 's1',
      agent: 'claude',
      project: 'shop',
      task: c.tasks[0],
      status: 'running',
      activity: c.activity[0],
      startedAt: now - 3 * MIN,
    },
    {
      id: 's2',
      agent: 'home',
      project: 'General',
      task: c.tasks[1],
      status: 'done',
      startedAt: now - 20 * MIN,
      finishedAt: now - 17 * MIN,
      resultPreview: c.result,
      resultUrl: 'http://localhost:5173',
    },
    {
      id: 's3',
      agent: 'codex',
      project: 'shop',
      task: c.tasks[2],
      status: 'approval',
      activity: c.activity[2],
      startedAt: now - 6 * MIN,
    },
  ];
}

export function mockProviders(): ProviderStatus[] {
  return [
    { id: 'chatgpt', connected: true, account: 'lorenzo@example.com', plan: 'ChatGPT Plus', usagePct: 12, state: 'ok', primary: true },
    { id: 'claude', connected: true, plan: 'Claude Max', state: 'ok', primary: false },
    { id: 'codex', connected: false, state: 'not-installed', primary: false },
    { id: 'api-anthropic', connected: false, state: 'needs-login', primary: false },
    { id: 'api-openai', connected: false, state: 'needs-login', primary: false },
    { id: 'local', connected: false, state: 'not-installed', primary: false },
  ];
}

export function mockChat(locale: Locale, now = Date.now()): ChatMessage[] {
  const c = COPY[locale];
  const sessions = mockSessions(locale, now);
  return [
    { id: 'm1', role: 'user', text: c.user, at: now - 5 * MIN, viaVoice: true },
    { id: 'm2', role: 'jarvis', text: c.jarvis, at: now - 5 * MIN + 2000, spoken: true },
    { id: 'm3', role: 'system', card: { type: 'session-started', session: sessions[0] as SessionView }, at: now - 3 * MIN },
    { id: 'm4', role: 'system', card: { type: 'reminder-set', text: c.reminder, dueAt: now + 20 * MIN }, at: now - MIN },
  ];
}

export function mockSnapshot(locale: Locale = 'en', now = Date.now()): MockSnapshot {
  const settings: Settings = { ...defaultSettings(), locale, userName: 'Lorenzo', onboardingComplete: true };
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
