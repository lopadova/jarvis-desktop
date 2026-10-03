/**
 * IPC contract (ADR 0002): JSON-RPC 2.0 over a loopback WebSocket guarded by a launch token.
 *
 * Three roles connect to the sidecar ("agent-host"):
 *  - `ui`    — the React webview(s): calls `app.*` methods, receives `ui.*` notifications.
 *  - `shell` — the Rust process: sends voice notifications (`voice.*`) and serves `host.*` requests
 *              (keyring, audio playback, opening files, notifications, clipboard, screenshots, typing).
 *  - `mcp`   — the stdio MCP bridge / relay link: calls `mcp.*` methods.
 */
import { z } from 'zod';

export const JSONRPC = '2.0' as const;

export const RoleSchema = z.enum(['ui', 'shell', 'mcp']);
export type Role = z.infer<typeof RoleSchema>;

export interface RpcRequest {
  jsonrpc: typeof JSONRPC;
  id: number | string;
  method: string;
  params?: unknown;
}
export interface RpcNotification {
  jsonrpc: typeof JSONRPC;
  method: string;
  params?: unknown;
}
export interface RpcResponse {
  jsonrpc: typeof JSONRPC;
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}
export type RpcMessage = RpcRequest | RpcNotification | RpcResponse;

export const RpcErrorCode = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  unauthorized: -32001,
  notAvailable: -32002,
} as const;

// ───────── app.* (ui → sidecar) ─────────

const id = z.string().min(1).max(128);

export const AppMethods = {
  'app.hello': z.object({ role: RoleSchema, version: z.string() }),
  'app.state': z.object({}),
  'turn.submit': z.object({ text: z.string().min(1).max(4000), source: z.enum(['voice', 'text', 'chip']) }),
  'voice.stopSpeaking': z.object({}),
  'session.stop': z.object({ id }),
  'session.reply': z.object({ id, text: z.string().min(1).max(4000) }),
  'session.dismiss': z.object({ id }),
  'session.clearFinished': z.object({}),
  'session.open': z.object({ id }),
  'session.showLog': z.object({ id }),
  'approval.decide': z.object({
    id,
    decision: z.enum(['allow-once', 'deny', 'always-allow-project']),
    via: z.enum(['click', 'voice', 'keyboard']),
  }),
  'settings.get': z.object({}),
  'settings.update': z.object({ patch: z.record(z.string(), z.unknown()) }),
  'projects.list': z.object({}),
  'projects.upsert': z.object({
    project: z.object({
      id: z.string().optional(),
      name: z.string().min(1).max(80),
      path: z.string().min(1),
      aliases: z.array(z.string()).default([]),
      defaultAgent: z.enum(['claude', 'codex', 'home']).default('claude'),
      permission: z.enum(['safe', 'trusted', 'full-auto']).default('safe'),
      allowlist: z.array(z.string()).default([]),
    }),
  }),
  'projects.remove': z.object({ id }),
  'memory.list': z.object({}),
  'memory.remove': z.object({ id }),
  'memory.clear': z.object({}),
  'history.list': z.object({ query: z.string().optional(), limit: z.number().int().min(1).max(500).default(100) }),
  'history.clear': z.object({ scope: z.enum(['today', 'all']) }),
  'providers.status': z.object({}),
  'providers.signIn': z.object({ provider: z.enum(['chatgpt']) }),
  'providers.signOut': z.object({ provider: z.enum(['chatgpt']) }),
  'providers.setPrimary': z.object({
    brain: z.enum(['chatgpt', 'claude', 'codex', 'api-anthropic', 'api-openai', 'local']),
  }),
  'secrets.set': z.object({
    key: z.enum(['openai-api-key', 'anthropic-api-key', 'elevenlabs-api-key', 'fish-audio-api-key']),
    value: z.string().min(1).max(4096),
  }),
  'secrets.delete': z.object({
    key: z.enum(['openai-api-key', 'anthropic-api-key', 'elevenlabs-api-key', 'fish-audio-api-key']),
  }),
  'tts.voices': z.object({
    provider: z.enum(['elevenlabs', 'fish', 'openai', 'kokoro', 'piper', 'system']),
    query: z.string().optional(),
  }),
  'tts.preview': z.object({
    provider: z.enum(['elevenlabs', 'fish', 'openai', 'kokoro', 'piper', 'system']),
    voiceId: z.string().optional(),
  }),
  'suggestions.list': z.object({}),
  'relay.status': z.object({}),
  'relay.pair': z.object({ relayUrl: z.string().url() }),
  'relay.unpair': z.object({}),
  'reminders.list': z.object({}),
  'reminders.cancel': z.object({ id }),
  'shopping.list': z.object({}),
  'shopping.remove': z.object({ id }),
  'shopping.clear': z.object({}),
  /** Copy a result Jarvis produced back to the system clipboard (user click only). */
  'clipboard.write': z.object({ text: z.string().min(1).max(20_000) }),
} as const;
export type AppMethod = keyof typeof AppMethods;
export type AppParams<M extends AppMethod> = z.input<(typeof AppMethods)[M]>;

// ───────── mcp.* (MCP bridge / relay link → sidecar) ─────────

/**
 * Tools exposed to other agents (Claude Desktop/Cowork, Claude Code, Codex, ChatGPT via relay).
 * `readOnly` drives MCP `readOnlyHint`; write tools are hidden on the ChatGPT relay unless the user enables them.
 */
export const McpTools = {
  jarvis_speak: {
    readOnly: false,
    destructive: false,
    description: "Say a short message out loud on the user's computer (≤ 300 characters).",
    params: z.object({ text: z.string().min(1).max(300) }),
  },
  jarvis_ask_user: {
    readOnly: false,
    destructive: false,
    description:
      'Ask the user a question out loud and wait for their spoken or clicked answer. Use when you are blocked and need a decision.',
    params: z.object({
      question: z.string().min(1).max(300),
      options: z.array(z.string().min(1).max(60)).max(4).optional(),
      timeoutSeconds: z.number().int().min(10).max(600).default(120),
    }),
  },
  jarvis_notify: {
    readOnly: false,
    destructive: false,
    description: 'Show a desktop notification to the user (silent).',
    params: z.object({ title: z.string().min(1).max(80), body: z.string().max(300).default('') }),
  },
  jarvis_start_task: {
    readOnly: false,
    destructive: false,
    description:
      "Start a background task on the user's computer with Jarvis (Claude Code, Codex or the Home agent). Risky steps still require the user's approval on their screen.",
    params: z.object({
      task: z.string().min(1).max(4000),
      project: z.string().max(80).optional(),
      agent: z.enum(['claude', 'codex', 'home']).optional(),
    }),
  },
  jarvis_list_sessions: {
    readOnly: true,
    destructive: false,
    description: 'List Jarvis background sessions with their status and latest activity.',
    params: z.object({}),
  },
  jarvis_session_result: {
    readOnly: true,
    destructive: false,
    description: 'Get the final result text of a Jarvis session.',
    params: z.object({ id: z.string().min(1) }),
  },
  jarvis_remember: {
    readOnly: false,
    destructive: false,
    description: 'Save a durable preference or fact about the user in Jarvis memory.',
    params: z.object({ text: z.string().min(1).max(300) }),
  },
  jarvis_recall: {
    readOnly: true,
    destructive: false,
    description: 'List what Jarvis remembers about the user (preferences and facts).',
    params: z.object({}),
  },
} as const;
export type McpToolName = keyof typeof McpTools;

/** IPC method used by the MCP bridge: `mcp.call` with { tool, args, origin }. */
export const McpCallSchema = z.object({
  tool: z.enum(Object.keys(McpTools) as [McpToolName, ...McpToolName[]]),
  args: z.record(z.string(), z.unknown()).default({}),
  origin: z.enum(['stdio', 'http', 'relay']),
  client: z.string().max(120).optional(),
});

// ───────── voice.* (shell → sidecar, notifications) ─────────

export const VoiceNotifications = {
  'voice.wake': z.object({ trigger: z.enum(['wake-word', 'push-to-talk', 'clap', 'barge-in', 'conversation']) }),
  'voice.partial': z.object({ partial: z.string(), committed: z.string(), level: z.number().min(0).max(1) }),
  'voice.transcript': z.object({ text: z.string(), trigger: z.string(), durationMs: z.number().optional() }),
  'voice.nothingHeard': z.object({ trigger: z.string() }),
  /** Raw 16 kHz PCM16 (base64) for cloud STT, only sent when the user enabled a cloud STT provider. */
  'voice.audio': z.object({ pcmBase64: z.string(), trigger: z.string() }),
  'voice.playbackLevel': z.object({ level: z.number().min(0).max(1) }),
  'voice.playbackEnded': z.object({ utteranceId: z.string() }),
  'host.focusChanged': z.object({ doNotDisturb: z.boolean() }),
} as const;

// ───────── host.* (sidecar → shell requests) ─────────

export interface HostMethods {
  'host.secret.get': { params: { key: string }; result: { value: string | null } };
  'host.secret.set': { params: { key: string; value: string }; result: { ok: true } };
  'host.secret.delete': { params: { key: string }; result: { ok: true } };
  /** Audio for an utterance arrives as binary frames: [16-byte utteranceId ascii][payload]; then `host.audio.end`. */
  'host.audio.begin': { params: { utteranceId: string; mime: string }; result: { ok: true } };
  'host.audio.end': { params: { utteranceId: string }; result: { ok: true } };
  'host.audio.stop': { params: Record<string, never>; result: { ok: true } };
  'host.audio.pause': { params: { paused: boolean }; result: { ok: true } };
  'host.systemSpeak': {
    params: { text: string; locale: string; rate: number; utteranceId: string };
    result: { ok: true };
  };
  'host.open': { params: { target: string; kind: 'url' | 'path' }; result: { ok: true } };
  'host.openTerminal': { params: { cwd: string; program?: string; args?: string[] }; result: { ok: true } };
  'host.notify': { params: { title: string; body: string }; result: { ok: true } };
  'host.clipboard.read': { params: Record<string, never>; result: { text: string | null } };
  'host.clipboard.write': { params: { text: string }; result: { ok: true } };
  /** Primary monitor as PNG, downscaled by the shell to at most ~2 MB. Never written to disk. */
  'host.screenshot': { params: Record<string, never>; result: { pngBase64: string } };
  'host.typeText': { params: { text: string }; result: { ok: true } };
  'host.setListening': {
    params: { mode: 'idle' | 'speaking' | 'busy' | 'conversation'; conversationMs?: number };
    result: { ok: true };
  };
  'host.showWindow': {
    params: { window: 'home' | 'settings' | 'onboarding' | 'sessions' | 'pill'; tab?: string };
    result: { ok: true };
  };
}
export type HostMethod = keyof HostMethods;

// ───────── ui.* (sidecar → ui notifications) ─────────

export const UI_EVENTS = [
  'ui.pill',
  'ui.sessions',
  'ui.chat',
  'ui.approval',
  'ui.providers',
  'ui.reminders',
  'ui.settings',
  'ui.toast',
  'ui.relay',
  /** Shopping list changed: { items: ShoppingItem[] }. */
  'ui.shopping',
  /** Ask the Home window to show a rail view: { view: 'home' | 'history' | 'memory' | 'projects' }. */
  'ui.navigate',
  /** History was cleared: { since } (epoch ms; 0 = everything). */
  'ui.history',
] as const;
export type UiEvent = (typeof UI_EVENTS)[number];

export function isResponse(m: RpcMessage): m is RpcResponse {
  return 'id' in m && !('method' in m);
}
export function isRequest(m: RpcMessage): m is RpcRequest {
  return 'id' in m && 'method' in m;
}
