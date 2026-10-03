/**
 * Mock-mode preview switches (design QA without the sidecar):
 *   ?theme=dark|light  &locale=en|it  &material=glass|solid  &private=1
 *   &pill=idle-hint|listening|thinking|speaking|clarify|approval-low|approval-medium|approval-high|error|muted
 *   &sessions=0 (empty state)  &onboarding=1
 */
import type { PillState } from '../types/ui';
import { type MockSnapshot, mockApproval } from './index';

export function previewPill(kind: string, locale: 'en' | 'it'): PillState | null {
  const it = locale === 'it';
  switch (kind) {
    case 'idle-hint':
      return { kind: 'idle-hint', shortcut: ['Alt', 'Space'] };
    case 'listening':
      return {
        kind: 'listening',
        level: 0.6,
        committed: it ? 'Jarvis, nel progetto shop' : 'Jarvis, in project shop',
        partial: it ? 'aggiungi un footer' : 'add a footer',
      };
    case 'thinking':
      return {
        kind: 'thinking',
        transcript: it ? 'Nel progetto shop aggiungi un footer' : 'In project shop add a footer',
        brain: 'chatgpt',
      };
    case 'speaking':
      return {
        kind: 'speaking',
        text: it ? 'Va bene, sto aggiungendo il footer allo shop.' : "Sure — I'm adding the footer to the shop now.",
        progress: 0.45,
        level: 0.5,
      };
    case 'clarify':
      return {
        kind: 'clarify',
        question: it ? 'Quale progetto intendi?' : 'Which project do you mean?',
        quickReplies: ['shop', 'blog', it ? 'Nessuno' : 'Neither'],
      };
    case 'approval-low':
    case 'approval-medium':
    case 'approval-high':
      return { kind: 'approval', request: mockApproval(locale, kind.slice(9) as 'low' | 'medium' | 'high') };
    case 'error':
      return {
        kind: 'error',
        message: it ? 'ChatGPT non risponde.' : 'ChatGPT is not responding.',
        actionLabel: it ? 'Apri impostazioni' : 'Open settings',
      };
    case 'muted':
      return { kind: 'muted', reason: 'focus' };
    default:
      return null;
  }
}

export function previewPatch(snap: MockSnapshot, search: string): Partial<MockSnapshot> {
  const q = new URLSearchParams(search);
  const locale = q.get('locale') === 'it' ? 'it' : snap.settings.locale;
  const theme = q.get('theme');
  const material = q.get('material');
  const settings: MockSnapshot['settings'] = {
    ...snap.settings,
    locale,
    ...(theme === 'dark' || theme === 'light' ? { theme: theme as 'dark' | 'light' } : {}),
    ...(material === 'glass' || material === 'solid' ? { material: material as 'glass' | 'solid' } : {}),
    ...(q.get('private') === '1' ? { privateMode: true } : {}),
    ...(q.get('onboarding') === '1' ? { onboardingComplete: false } : {}),
  };
  const pillState = previewPill(q.get('pill') ?? '', locale);
  return {
    settings,
    pill: { state: pillState ?? snap.pill.state, privateMode: settings.privateMode },
    pending: pillState?.kind === 'approval' ? [pillState.request] : snap.pending,
    sessions: q.get('sessions') === '0' ? [] : snap.sessions,
  };
}
