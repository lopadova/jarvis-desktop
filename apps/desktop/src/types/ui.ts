/**
 * UI data contracts — docs/design/DESIGN-BRIEF.md §7.
 * The view-model types are re-exported from `@jarvis/core` (single source of truth); the component
 * props interfaces below are the brief's, verbatim, so the final design template drops in unchanged.
 */
import type {
  AgentId,
  ApprovalDecision,
  ApprovalKind,
  ApprovalRequest,
  BrainId,
  ChatMessage,
  Locale,
  Material,
  PermissionLevel,
  PillEvent,
  PillState,
  Platform,
  ProviderStatus,
  RiskLevel,
  SessionStatus,
  SessionView,
  Suggestion,
  SuggestionCategory,
  SystemCardData,
  Theme,
} from '@jarvis/core';

export type {
  AgentId,
  ApprovalDecision,
  ApprovalKind,
  ApprovalRequest,
  BrainId,
  ChatMessage,
  Locale,
  Material,
  PermissionLevel,
  PillEvent,
  PillState,
  Platform,
  ProviderStatus,
  RiskLevel,
  SessionStatus,
  SessionView,
  Suggestion,
  SuggestionCategory,
  SystemCardData,
  Theme,
};

/** Views of the Home window rail. */
export type RailView = 'home' | 'history' | 'memory' | 'projects';

export interface ListeningPillProps {
  state: PillState;
  privateMode: boolean;
  platform: Platform;
  onStop?(): void;
  onQuickReply?(text: string): void;
  onErrorAction?(): void;
  onApprovalDecision?(id: string, decision: ApprovalDecision): void;
}

export interface SessionCardProps {
  session: SessionView;
  locale: Locale;
  onOpen?(id: string): void;
  onLog?(id: string): void;
  onReply?(id: string, text: string): void;
  onStop?(id: string): void;
  onDismiss?(id: string): void;
}

export interface SuggestionGridProps {
  suggestions: Suggestion[];
  activeCategory: SuggestionCategory | 'for-you';
  onCategoryChange(c: SuggestionCategory | 'for-you'): void;
  onPick(s: Suggestion): void;
}

/** OS-keyring secret names the UI may set (values never stay in UI state — R6). */
export type SecretKey = 'openai-api-key' | 'anthropic-api-key' | 'elevenlabs-api-key' | 'fish-audio-api-key';

export type RelayStatus = 'unpaired' | 'connecting' | 'connected' | 'offline';

/** `ui.relay` payload (agent-host). */
export interface RelayState {
  status: RelayStatus;
  relayUrl?: string;
  pairId?: string;
  code?: string;
  qr?: string;
  error?: string;
}

export type ToastLevel = 'info' | 'success' | 'warning' | 'error';
export interface ToastData {
  id: string;
  level: ToastLevel;
  title: string;
  body?: string;
}

/** Shell → webview: on-device model download status (Tauri event `voice://models`). */
export interface ModelStatus {
  id: string;
  label: string;
  state: 'missing' | 'downloading' | 'verifying' | 'ready' | 'error';
  received: number;
  total: number;
  error?: string;
}
