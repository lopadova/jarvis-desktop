/** UI view-model types — identical to docs/design/DESIGN-BRIEF.md §7 so the design template plugs in as-is. */
import type { AgentId, ApprovalDecision, ApprovalRequest, BrainId, SessionView } from './model.js';
import type { Suggestion, SuggestionCategory } from './suggestions.js';

export type Theme = 'dark' | 'light';
export type Material = 'glass' | 'solid';

export type PillState =
  | { kind: 'hidden' }
  | { kind: 'idle-hint'; shortcut: string[] }
  | { kind: 'listening'; level: number; partial: string; committed: string }
  | { kind: 'thinking'; transcript: string; brain?: BrainId }
  | { kind: 'speaking'; text: string; progress: number; level: number }
  | { kind: 'clarify'; question: string; quickReplies: string[] }
  | { kind: 'approval'; request: ApprovalRequest }
  | { kind: 'error'; message: string; actionLabel?: string }
  | { kind: 'muted'; reason: 'focus' | 'user' };

export interface PillEvent {
  state: PillState;
  privateMode: boolean;
}

export type SystemCardData =
  | { type: 'session-started'; session: SessionView }
  | { type: 'approval-needed'; request: ApprovalRequest }
  | { type: 'result-ready'; session: SessionView }
  | { type: 'reminder-set'; text: string; dueAt: number }
  | { type: 'timer'; label: string; endsAt: number }
  | {
      type: 'briefing';
      weather?: string;
      events: { time: string; title: string }[];
      emails: { from: string; subject: string }[];
    };

export type ChatMessage =
  | { id: string; role: 'user'; text: string; at: number; viaVoice: boolean }
  | { id: string; role: 'jarvis'; text: string; at: number; spoken: boolean }
  | { id: string; role: 'system'; card: SystemCardData; at: number };

export type { AgentId, ApprovalDecision, ApprovalRequest, Suggestion, SuggestionCategory };
