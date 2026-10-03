/**
 * `mcp.call` handler: implements every tool in core `McpTools` for the stdio/HTTP MCP bridge and the
 * ChatGPT relay. Arguments are validated with each tool's zod schema. Write tools coming from the relay
 * are refused unless the user enabled `relayExposeWriteTools` (R9); relayed calls are always shown in
 * the UI, and anything they start still goes through local approvals.
 */
import {
  type AgentId,
  type Logger,
  type McpToolName,
  McpTools,
  type Memory,
  type Session,
  type Settings,
} from '@jarvis/core';
import type { HostClient, UiSink } from './host.js';
import { extraPhrases } from './phrases-extra.js';

export type McpOrigin = 'stdio' | 'http' | 'relay';

export interface McpCallInput {
  tool: McpToolName;
  args: Record<string, unknown>;
  origin: McpOrigin;
  /** Free-form client label (display only — never used for authorisation). */
  client?: string;
  /** Agent session proven by its per-session MCP token (set by the transport, never by the client). */
  callerSessionId?: string;
}

export interface McpResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

export interface McpHandlerDeps {
  settings: () => Settings;
  logger: Logger;
  ui: UiSink;
  host: HostClient;
  speak: (text: string) => Promise<void>;
  /** Shows a clarify pill, speaks the question; resolves with the answer or null on timeout. */
  ask: (question: string, options: string[], timeoutMs: number) => Promise<string | null>;
  /** Marks a verified calling session as waiting on the user (`needs-input`) while `jarvis_ask_user` waits. */
  setNeedsInput?: (sessionId: string, waiting: boolean) => void;
  startTask: (
    req: { task: string; project?: string; agent?: AgentId },
    origin: { via: McpOrigin; client?: string; callerSessionId?: string },
  ) => Promise<{ ok: boolean; message: string; sessionId?: string }>;
  sessions: () => Session[];
  remember: (text: string) => Memory | null;
  recall: () => Memory[];
  /** High-risk, click-only approval in the UI for writes requested by unverified (external) callers. */
  confirm: (title: string, detail: string) => Promise<boolean>;
}

const text = (t: string, isError = false): McpResult =>
  isError ? { content: [{ type: 'text', text: t }], isError: true } : { content: [{ type: 'text', text: t }] };

export const isWriteTool = (tool: McpToolName): boolean => !McpTools[tool].readOnly;

/** Tools offered to a given origin (relay: read-only unless write tools are enabled). */
export function exposedTools(origin: McpOrigin, settings: Settings): McpToolName[] {
  return (Object.keys(McpTools) as McpToolName[]).filter(
    (t) => origin !== 'relay' || !isWriteTool(t) || settings.relayExposeWriteTools,
  );
}

/** Rate-limit bucket: the verified session, else the whole origin (client labels are spoofable). */
const callerKey = (i: McpCallInput): string =>
  i.callerSessionId ? `session:${i.callerSessionId}` : `external:${i.origin}`;

/** Speak/notify rate limit per caller (anti-spam). */
export const NOISY_LIMIT = { calls: 6, windowMs: 60_000 };

export class McpHandler {
  private readonly noisy = new Map<string, number[]>();

  constructor(
    private readonly deps: McpHandlerDeps,
    private readonly now: () => number = Date.now,
  ) {}

  private rateLimited(key: string): boolean {
    const t = this.now();
    const recent = (this.noisy.get(key) ?? []).filter((x) => t - x < NOISY_LIMIT.windowMs);
    if (recent.length >= NOISY_LIMIT.calls) {
      this.noisy.set(key, recent);
      return true;
    }
    recent.push(t);
    this.noisy.set(key, recent);
    return false;
  }

  async call(input: McpCallInput): Promise<McpResult> {
    const { tool, origin } = input;
    const def = McpTools[tool];
    const settings = this.deps.settings();
    const x = extraPhrases(settings.locale);
    this.deps.logger.info('mcp call', { tool, origin, client: input.client });
    if ((tool === 'jarvis_speak' || tool === 'jarvis_notify') && this.rateLimited(callerKey(input))) {
      return text('Rate limit: too many messages in the last minute. Try again later.', true);
    }
    if (origin === 'relay' || isWriteTool(tool)) {
      this.deps.ui.emit('ui.toast', {
        level: 'info',
        title: `${input.client ?? origin} used ${tool.replace(/^jarvis_/, '').replace(/_/g, ' ')}`,
        body: origin === 'relay' ? 'via the remote relay' : `via ${origin}`,
      });
    }
    if (origin === 'relay' && isWriteTool(tool) && !settings.relayExposeWriteTools) {
      return text(x.relayWriteRefused, true);
    }
    const parsed = def.params.safeParse(input.args ?? {});
    if (!parsed.success) {
      return text(
        `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        true,
      );
    }
    const a = parsed.data as Record<string, unknown>;
    switch (tool) {
      case 'jarvis_speak':
        await this.deps.speak(String(a.text));
        return text('Spoken.');
      case 'jarvis_ask_user': {
        const caller = input.callerSessionId;
        if (caller) this.deps.setNeedsInput?.(caller, true);
        try {
          const answer = await this.deps.ask(
            String(a.question),
            (a.options as string[] | undefined) ?? [],
            Number(a.timeoutSeconds) * 1000,
          );
          return answer === null ? text(x.noAnswer) : text(answer);
        } finally {
          if (caller) this.deps.setNeedsInput?.(caller, false);
        }
      }
      case 'jarvis_notify':
        if (!this.deps.host.connected) return text('The desktop shell is not connected.', true);
        await this.deps.host.call('host.notify', { title: String(a.title), body: String(a.body ?? '') });
        return text('Notified.');
      case 'jarvis_start_task': {
        const req: { task: string; project?: string; agent?: AgentId } = { task: String(a.task) };
        if (typeof a.project === 'string') req.project = a.project;
        if (typeof a.agent === 'string') req.agent = a.agent as AgentId;
        const via: { via: McpOrigin; client?: string; callerSessionId?: string } = { via: origin };
        if (input.client) via.client = input.client;
        // The verified caller only lowers the permission cap; it never skips the user's click.
        if (input.callerSessionId) via.callerSessionId = input.callerSessionId;
        const who = input.callerSessionId ? `Agent session ${input.callerSessionId}` : (input.client ?? origin);
        const where = req.project ? ` in project ${req.project}` : '';
        const allowed = await this.deps.confirm(
          'start another background task',
          `${who} wants to start a ${req.agent ?? 'default'} task${where}: ${req.task}`,
        );
        if (!allowed) return text('The user declined to start this task.', true);
        const r = await this.deps.startTask(req, via);
        return text(r.sessionId ? `${r.message} (session ${r.sessionId})` : r.message, !r.ok);
      }
      case 'jarvis_list_sessions': {
        const list = this.deps.sessions().filter((s) => !s.dismissed);
        if (!list.length) return text('No sessions.');
        return text(
          list
            .slice(0, 20)
            .map(
              (s) =>
                `${s.id} · ${s.project} · ${s.agent} · ${s.status}${s.activity ? ` · ${s.activity}` : ''} · ${s.task.slice(0, 100)}`,
            )
            .join('\n'),
        );
      }
      case 'jarvis_session_result': {
        const s = this.deps.sessions().find((x) => x.id === a.id);
        if (!s) return text(x.unknownSession, true);
        return text(s.resultText ?? `Session is ${s.status}; no result yet.`);
      }
      case 'jarvis_remember': {
        // Single gate for every caller (agents could bypass canUseTool by calling mcp.call directly).
        const who = input.callerSessionId ? `Agent session ${input.callerSessionId}` : (input.client ?? origin);
        const allowed = await this.deps.confirm(
          'save something to memory',
          `${who} wants Jarvis to remember: ${String(a.text)}`,
        );
        if (!allowed) return text('The user declined.', true);
        const m = this.deps.remember(String(a.text));
        return text(m ? `Remembered (${m.id}).` : 'Nothing to remember.');
      }
      case 'jarvis_recall': {
        const list = this.deps.recall();
        return text(list.length ? list.map((m) => `- [${m.id}] ${m.text}`).join('\n') : 'Nothing saved.');
      }
      default:
        return text(`Unknown tool ${tool satisfies never}`, true);
    }
  }
}
