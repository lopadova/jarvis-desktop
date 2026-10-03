/**
 * Mock-mode preview switches (design QA without the sidecar):
 *   ?theme=dark|light  &locale=en|it  &material=glass|solid  &private=1  &hue=200
 *   &pill=idle-hint|listening|thinking|speaking|clarify|approval-low|approval-medium|approval-high|error|muted
 *   &sessions=0 (empty state)  &onboarding=1
 * Sample copy mirrors the Claude Design handoff (docs/design/handoff/).
 */
import type { PillState } from '../types/ui';
import { type MockSnapshot, mockApproval } from './index';

export function previewPill(kind: string, locale: 'en' | 'it', privateMode = false): PillState | null {
  const it = locale === 'it';
  switch (kind) {
    case 'idle-hint':
      return { kind: 'idle-hint', shortcut: ['Alt', 'Space'] };
    case 'listening':
      return privateMode
        ? {
            kind: 'listening',
            level: 0.6,
            committed: it ? 'Jarvis, riassumi quello che' : 'Jarvis, summarise what I',
            partial: '',
          }
        : {
            kind: 'listening',
            level: 0.6,
            committed: it ? 'Jarvis, nel progetto shop aggiungi' : 'Jarvis, in project shop add a',
            partial: it ? 'un fo' : 'foo',
          };
    case 'thinking':
      return {
        kind: 'thinking',
        transcript: it ? 'Jarvis, nel progetto shop aggiungi un footer' : 'Jarvis, in project shop add a footer',
        brain: 'chatgpt',
      };
    case 'speaking':
      return {
        kind: 'speaking',
        text: it
          ? 'Ci penso io — Claude Code parte in shop. Ti avviso quando ha finito.'
          : 'On it — Claude Code is starting in shop. I’ll tell you when it’s done.',
        progress: 0.45,
        level: 0.5,
      };
    case 'clarify':
      return {
        kind: 'clarify',
        question: it ? 'Quali due portatili?' : 'Which two laptops?',
        quickReplies: it
          ? ['I due nelle schede aperte', 'MacBook Air vs XPS 13', 'Lascia stare']
          : ['The two in my open tabs', 'MacBook Air vs XPS 13', 'Never mind'],
      };
    case 'approval-low':
    case 'approval-medium':
    case 'approval-high':
      return { kind: 'approval', request: mockApproval(locale, kind.slice(9) as 'low' | 'medium' | 'high') };
    case 'error':
      return {
        kind: 'error',
        message: it
          ? 'Non posso ancora cercare nella cartella Documenti.'
          : 'I can’t search your Documents folder yet.',
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
  const hue = Number(q.get('hue'));
  const settings: MockSnapshot['settings'] = {
    ...snap.settings,
    locale,
    ...(theme === 'dark' || theme === 'light' ? { theme: theme as 'dark' | 'light' } : {}),
    ...(material === 'glass' || material === 'solid' ? { material: material as 'glass' | 'solid' } : {}),
    ...(q.get('private') === '1' ? { privateMode: true } : {}),
    ...(q.get('onboarding') === '1' ? { onboardingComplete: false } : {}),
    ...(Number.isFinite(hue) && hue > 0 && hue <= 360 ? { accentHue: hue } : {}),
  };
  const pillState = previewPill(q.get('pill') ?? '', locale, settings.privateMode);
  return {
    settings,
    pill: { state: pillState ?? snap.pill.state, privateMode: settings.privateMode },
    pending: pillState?.kind === 'approval' ? [pillState.request] : snap.pending,
    sessions: q.get('sessions') === '0' ? [] : snap.sessions,
    // First run: nothing is connected yet.
    ...(q.get('onboarding') === '1'
      ? {
          providers: [
            { id: 'chatgpt', connected: false, state: 'needs-login', primary: false },
            { id: 'claude', connected: false, state: 'needs-login', primary: false },
            { id: 'api-anthropic', connected: false, state: 'not-installed', primary: false },
            { id: 'local', connected: false, state: 'not-installed', primary: false },
          ],
        }
      : {}),
  };
}
