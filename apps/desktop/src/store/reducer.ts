/**
 * Pure reducer from sidecar `ui.*` notifications (and the `app.state` snapshot) to UI state.
 * Kept free of React/zustand so it is trivially unit-testable.
 */
import { defaultSettings, type Reminder, type Settings } from '@jarvis/core';
import type { ConnectionStatus } from '../ipc/client';
import type {
  ApprovalDecision,
  ApprovalRequest,
  ChatMessage,
  ModelStatus,
  PillEvent,
  ProviderStatus,
  RelayState,
  SessionView,
  Suggestion,
  ToastData,
  ToastLevel,
} from '../types/ui';

export interface UiState {
  connection: ConnectionStatus;
  ready: boolean;
  version: string;
  settings: Settings;
  sessions: SessionView[];
  pending: ApprovalRequest[];
  /** Decisions taken on approvals (from `ui.approval` resolved events), shown on chat cards. */
  resolved: Record<string, ApprovalDecision>;
  providers: ProviderStatus[];
  reminders: Reminder[];
  chat: ChatMessage[];
  pill: PillEvent;
  relay: RelayState;
  suggestions: Suggestion[];
  toasts: ToastData[];
  models: ModelStatus[];
  micLevel: number;
  /** True while the user holds push-to-talk (global shortcut or composer mic). */
  pushToTalk: boolean;
  /** The shell has the microphone open (R11 indicator). */
  micOpen: boolean;
}

export const initialState = (): UiState => ({
  connection: 'closed',
  ready: false,
  version: '',
  settings: defaultSettings(),
  sessions: [],
  pending: [],
  resolved: {},
  providers: [],
  reminders: [],
  chat: [],
  pill: { state: { kind: 'hidden' }, privateMode: false },
  relay: { status: 'unpaired' },
  suggestions: [],
  toasts: [],
  models: [],
  micLevel: 0,
  pushToTalk: false,
  micOpen: false,
});

export interface AppStateSnapshot {
  settings: Settings;
  sessions: SessionView[];
  pending: ApprovalRequest[];
  providers: ProviderStatus[];
  reminders: Reminder[];
  chat: ChatMessage[];
  pill: PillEvent;
  relay: RelayState;
  version: string;
}

const MAX_CHAT = 500;
const MAX_TOASTS = 4;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const arr = <T>(v: unknown): T[] | undefined => (Array.isArray(v) ? (v as T[]) : undefined);

export function applySnapshot(state: UiState, snap: Partial<AppStateSnapshot>): UiState {
  return {
    ...state,
    ready: true,
    version: snap.version ?? state.version,
    settings: snap.settings ?? state.settings,
    sessions: snap.sessions ?? state.sessions,
    pending: snap.pending ?? state.pending,
    providers: snap.providers ?? state.providers,
    reminders: snap.reminders ?? state.reminders,
    chat: snap.chat ?? state.chat,
    pill: snap.pill ?? state.pill,
    relay: snap.relay ?? state.relay,
  };
}

/** Append a chat message, or replace the one with the same id (streamed replies). */
export function upsertChat(chat: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const i = chat.findIndex((m) => m.id === message.id);
  if (i >= 0) {
    const next = chat.slice();
    next[i] = message;
    return next;
  }
  const next = [...chat, message];
  return next.length > MAX_CHAT ? next.slice(next.length - MAX_CHAT) : next;
}

let toastSeq = 0;

export function applyUiEvent(state: UiState, method: string, params: unknown): UiState {
  if (!isObj(params)) return state;
  switch (method) {
    case 'ui.pill':
      return isObj(params.state) ? { ...state, pill: params as unknown as PillEvent } : state;
    case 'ui.sessions': {
      const sessions = arr<SessionView>(params.sessions);
      return sessions ? { ...state, sessions } : state;
    }
    case 'ui.chat':
      return isObj(params.message) ? { ...state, chat: upsertChat(state.chat, params.message as ChatMessage) } : state;
    case 'ui.approval': {
      const pending = arr<ApprovalRequest>(params.pending);
      if (!pending) return state;
      const decided =
        params.state === 'resolved' && typeof params.id === 'string' && typeof params.decision === 'string'
          ? { ...state.resolved, [params.id]: params.decision as ApprovalDecision }
          : state.resolved;
      return { ...state, pending, resolved: decided };
    }
    case 'ui.providers': {
      const providers = arr<ProviderStatus>(params.providers);
      return providers ? { ...state, providers } : state;
    }
    case 'ui.reminders': {
      const reminders = arr<Reminder>(params.reminders);
      return reminders ? { ...state, reminders } : state;
    }
    case 'ui.settings':
      return isObj(params.settings) ? { ...state, settings: params.settings as Settings } : state;
    case 'ui.relay':
      return typeof params.status === 'string' ? { ...state, relay: params as unknown as RelayState } : state;
    case 'ui.toast': {
      if (typeof params.title !== 'string') return state;
      const level: ToastLevel = (['info', 'success', 'warning', 'error'] as const).includes(params.level as ToastLevel)
        ? (params.level as ToastLevel)
        : 'info';
      const toast: ToastData = {
        id: `t${++toastSeq}`,
        level,
        title: params.title,
        body: typeof params.body === 'string' ? params.body : undefined,
      };
      return { ...state, toasts: [...state.toasts, toast].slice(-MAX_TOASTS) };
    }
    default:
      return state;
  }
}

export function dismissToast(state: UiState, id: string): UiState {
  return { ...state, toasts: state.toasts.filter((t) => t.id !== id) };
}
