/**
 * Domain model shared by the sidecar, the UI and (later) the mobile companion.
 * UI-facing names intentionally match docs/design/DESIGN-BRIEF.md §7.
 */

export type Locale = 'en' | 'it';
export type Platform = 'mac' | 'win' | 'linux';

export type BrainId = 'chatgpt' | 'claude' | 'codex' | 'api-anthropic' | 'api-openai' | 'local';
export type AgentId = 'claude' | 'codex' | 'home';
export type TtsId = 'elevenlabs' | 'fish' | 'openai' | 'kokoro' | 'piper' | 'system';
export type SttId = 'local-whisper' | 'openai' | 'elevenlabs';

export type PermissionLevel = 'safe' | 'trusted' | 'full-auto';

export interface Project {
  id: string;
  name: string;
  path: string;
  aliases: string[];
  defaultAgent: AgentId;
  permission: PermissionLevel;
  /** Shell command prefixes always allowed in `trusted` mode, e.g. "pnpm test". */
  allowlist: string[];
}

export type SessionStatus = 'running' | 'needs-input' | 'approval' | 'done' | 'failed' | 'cancelled';

/** Statuses that still hold a live agent process and count against the concurrency limit. */
export const LIVE_STATUSES: readonly SessionStatus[] = ['running', 'needs-input', 'approval'];
export const isLive = (s: SessionStatus): boolean => LIVE_STATUSES.includes(s);

export interface Session {
  id: string;
  agent: AgentId;
  projectId: string | null;
  project: string;
  cwd: string;
  task: string;
  status: SessionStatus;
  activity?: string;
  startedAt: number;
  finishedAt?: number;
  /** Agent-side id used to resume (Claude session_id / Codex thread id). */
  agentSessionId?: string;
  resultText?: string;
  resultUrl?: string;
  coding: boolean;
  dismissed: boolean;
}

export interface SessionView {
  id: string;
  agent: AgentId;
  project: string;
  task: string;
  status: SessionStatus;
  activity?: string;
  startedAt: number;
  finishedAt?: number;
  resultPreview?: string;
  resultUrl?: string;
}

export const toSessionView = (s: Session): SessionView => ({
  id: s.id,
  agent: s.agent,
  project: s.project,
  task: s.task,
  status: s.status,
  activity: s.activity,
  startedAt: s.startedAt,
  finishedAt: s.finishedAt,
  resultPreview: s.resultText?.slice(0, 240),
  resultUrl: s.resultUrl,
});

export interface Memory {
  id: string;
  text: string;
  createdAt: number;
  source: 'said' | 'inferred';
}

export interface Turn {
  at: number;
  heard: string;
  said: string;
  action: string;
  task?: string;
  project?: string;
}

export interface Reminder {
  id: string;
  text: string;
  dueAt: number;
  kind: 'reminder' | 'timer' | 'alarm';
  done: boolean;
}

export type RiskLevel = 'low' | 'medium' | 'high';
export type ApprovalKind = 'shell' | 'file-write' | 'file-delete' | 'network' | 'mcp-tool';
export type ApprovalDecision = 'allow-once' | 'deny' | 'always-allow-project';

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  kind: ApprovalKind;
  risk: RiskLevel;
  title: string;
  detail: string;
  cwd?: string;
  agent: AgentId;
  project?: string;
  reason?: string;
  expiresAt?: number;
}

export interface ProviderStatus {
  id: BrainId;
  connected: boolean;
  account?: string;
  plan?: string;
  usagePct?: number;
  state: 'ok' | 'needs-login' | 'cap-reached' | 'error' | 'not-installed';
  primary: boolean;
}
