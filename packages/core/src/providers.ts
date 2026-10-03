/**
 * Provider contracts. Implementations live in @jarvis/providers (brains, TTS, cloud STT) and
 * @jarvis/agent-host (agent drivers). Everything is optional at runtime: the registry reports
 * what is available and the app degrades gracefully.
 */
import type { AgentId, ApprovalDecision, ApprovalRequest, BrainId, ProviderStatus, SttId, TtsId } from './model.js';

// ───────────────────────────── Brains ─────────────────────────────

export interface BrainMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface BrainImage {
  mime: 'image/png';
  base64: string;
}

export interface BrainRequest {
  messages: BrainMessage[];
  /** Images attached to the last user message (vision). Only sent to brains with `vision: true`. */
  images?: BrainImage[];
  /** JSON Schema for structured output; providers that cannot enforce it fall back to JSON-in-text. */
  jsonSchema?: Record<string, unknown>;
  /** Hint: 'fast' for routing, 'smart' for summaries/answers that need quality. */
  tier?: 'fast' | 'smart';
  signal?: AbortSignal;
  /** Streaming callback for text deltas (used to start TTS before the reply is complete). */
  onDelta?: (text: string) => void;
}

export interface BrainResponse {
  text: string;
  /** Parsed JSON when jsonSchema was requested and the provider returned structured output. */
  json?: unknown;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not-configured'
      | 'needs-login'
      | 'cap-reached'
      | 'rate-limited'
      | 'network'
      | 'bad-response'
      | 'aborted'
      | 'unknown',
    readonly provider: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface BrainProvider {
  readonly id: BrainId;
  readonly label: string;
  /** True when `complete` accepts `images` (the model may still reject them with a ProviderError). */
  readonly vision?: boolean;
  status(): Promise<ProviderStatus>;
  complete(req: BrainRequest): Promise<BrainResponse>;
}

// ───────────────────────────── Agents ─────────────────────────────

export type AgentEvent =
  | { type: 'session-id'; id: string }
  | { type: 'activity'; text: string }
  | { type: 'narration'; text: string }
  | { type: 'text'; text: string }
  | {
      type: 'approval';
      request: Omit<ApprovalRequest, 'id' | 'sessionId' | 'agent' | 'risk'> & { risk?: ApprovalRequest['risk'] };
    }
  | { type: 'result'; text: string; isError: boolean; url?: string }
  | { type: 'exit'; code: number };

export interface AgentRunOptions {
  task: string;
  cwd: string;
  resumeId?: string;
  model?: string;
  /** Extra system guidance (standing preferences, voice-friendly output rules). */
  guidance: string;
  permission: 'safe' | 'trusted' | 'full-auto';
  allowlist: string[];
  signal: AbortSignal;
  /** Called for every permission request; must resolve with the user's decision. */
  requestApproval(req: Omit<ApprovalRequest, 'id' | 'sessionId' | 'agent'>): Promise<ApprovalDecision>;
  /** MCP servers to attach (Jarvis' own MCP is always included by the host). */
  mcpServers?: Record<string, unknown>;
}

export interface AgentDriver {
  readonly id: AgentId;
  readonly label: string;
  available(): Promise<{ ok: boolean; detail: string }>;
  run(opts: AgentRunOptions): AsyncIterable<AgentEvent>;
}

// ───────────────────────────── Voice ─────────────────────────────

export interface TtsRequest {
  /** Text with neutral cues ([happy], [laugh] …); the provider maps or strips them. */
  text: string;
  locale: string;
  voiceId?: string;
  speed?: number;
  signal?: AbortSignal;
}

export interface TtsAudio {
  /** e.g. 'audio/mpeg', 'audio/pcm;rate=24000' */
  mime: string;
  chunks: AsyncIterable<Uint8Array>;
}

export interface TtsVoice {
  id: string;
  name: string;
  locale?: string;
  tags?: string[];
}

export interface TtsProvider {
  readonly id: TtsId;
  readonly label: string;
  readonly supportsCues: boolean;
  configured(): Promise<boolean>;
  synthesize(req: TtsRequest): Promise<TtsAudio>;
  voices?(query?: string, locale?: string): Promise<TtsVoice[]>;
}

export interface SttRequest {
  /** 16 kHz mono PCM16 little-endian. */
  pcm: Uint8Array;
  locale: string;
  signal?: AbortSignal;
}

export interface SttProvider {
  readonly id: SttId;
  readonly label: string;
  configured(): Promise<boolean>;
  transcribe(req: SttRequest): Promise<{ text: string }>;
}

// ───────────────────────────── Secrets ─────────────────────────────

/** Backed by the OS keyring (Rust side) — never by files or settings. */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export const SECRET_KEYS = {
  openaiApiKey: 'openai-api-key',
  anthropicApiKey: 'anthropic-api-key',
  elevenlabsApiKey: 'elevenlabs-api-key',
  fishApiKey: 'fish-audio-api-key',
  chatgptTokens: 'chatgpt-plan-tokens',
  chatgptClient: 'chatgpt-plan-client',
  relaySecret: 'relay-pairing-secret',
} as const;

// ───────────────────────────── Logging ─────────────────────────────

/** Structured logger; implementations must redact secrets (security-model R6). */
export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
