/**
 * Claude Code driver over `@anthropic-ai/claude-agent-sdk`.
 * - Uses the user's own Claude Code install (`pathToClaudeCodeExecutable`) so their subscription login
 *   applies; ANTHROPIC_API_KEY is removed from the child env (no silent pay-per-use, R10).
 * - Every permission request goes through `canUseTool` → classifyRisk → gate → Jarvis approval (R1/R2).
 * - The child is spawned by us (`spawnClaudeCodeProcess`) in its own process group, and its PID/start
 *   time is reported for tree-kill and orphan reaping (R7). The prompt goes through stdin/SDK, never argv.
 * - Jarvis' own MCP server is attached so the agent can call `jarvis_ask_user` when blocked.
 */
import { spawn } from 'node:child_process';
import { extname } from 'node:path';
import type {
  CanUseTool,
  McpServerConfig,
  Options,
  query as QueryFn,
  SDKMessage,
  SpawnedProcess,
  SpawnOptions,
} from '@anthropic-ai/claude-agent-sdk';
import type { AgentDriver, AgentEvent, Logger, Settings } from '@jarvis/core';
import { safeOpenable } from '../viewable.js';
import {
  AsyncQueue,
  activityFor,
  childEnv,
  commonBinDirs,
  composeGuidance,
  decideTool,
  describeClaudeTool,
  discoverExecutable,
  type HostRunOptions,
} from './common.js';

export interface McpCommand {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface ClaudeDriverDeps {
  settings: () => Settings;
  logger: Logger;
  /** Jarvis' MCP bridge command (from JARVIS_MCP_COMMAND), or null. */
  mcpCommand: () => McpCommand | null;
  /** Injectable for tests. Defaults to a lazy import of the SDK. */
  query?: typeof QueryFn;
  discover?: () => string | null;
}

export class ClaudeDriver implements AgentDriver {
  readonly id = 'claude' as const;
  readonly label = 'Claude Code';

  constructor(private readonly deps: ClaudeDriverDeps) {}

  executable(): string | null {
    if (this.deps.discover) return this.deps.discover();
    return discoverExecutable('claude', this.deps.settings().claudePath, commonBinDirs());
  }

  async available(): Promise<{ ok: boolean; detail: string }> {
    const exe = this.executable();
    return exe ? { ok: true, detail: exe } : { ok: false, detail: 'Claude Code CLI not found' };
  }

  async *run(opts: HostRunOptions): AsyncIterable<AgentEvent> {
    const exe = this.executable();
    if (!exe) {
      yield { type: 'result', text: 'Claude Code is not installed.', isError: true };
      yield { type: 'exit', code: 1 };
      return;
    }
    const query = this.deps.query ?? (await import('@anthropic-ai/claude-agent-sdk')).query;
    const settings = this.deps.settings();
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    opts.signal.addEventListener('abort', onAbort, { once: true });

    const canUseTool: CanUseTool = async (toolName, input, { blockedPath }) => {
      const req = describeClaudeTool(toolName, input, opts.cwd, blockedPath);
      if (req === 'allow') return { behavior: 'allow', updatedInput: input };
      const v = await decideTool(req, opts);
      return v.allow ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: v.message };
    };

    const mcpServers: Record<string, McpServerConfig> = {
      ...((opts.mcpServers ?? {}) as Record<string, McpServerConfig>),
    };
    const mcp = this.deps.mcpCommand();
    if (mcp) {
      // The per-session token proves to the sidecar which session is calling, so anything it starts is
      // capped at this session's permission level. It travels only in this MCP server's env.
      const env: Record<string, string> = { ...(mcp.env ?? {}) };
      if (opts.mcpSessionToken) env.JARVIS_MCP_SESSION_TOKEN = opts.mcpSessionToken;
      mcpServers.jarvis = { type: 'stdio', command: mcp.command, args: mcp.args, env };
    }

    const logger = this.deps.logger;
    const spawnClaudeCodeProcess = (o: SpawnOptions): SpawnedProcess => {
      const child = spawn(o.command, o.args, {
        cwd: o.cwd,
        env: o.env as NodeJS.ProcessEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
        signal: o.signal,
      });
      if (child.pid) opts.onProcess?.(child.pid, Date.now());
      child.stderr?.on('data', (d: Buffer) => logger.debug('claude stderr', { text: d.toString().slice(0, 500) }));
      return child as unknown as SpawnedProcess;
    };

    const options: Options = {
      cwd: opts.cwd,
      abortController: abort,
      pathToClaudeCodeExecutable: exe,
      env: childEnv({ CLAUDE_AGENT_SDK_CLIENT_APP: 'jarvis-desktop/0.1.0' }),
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: composeGuidance(opts, opts.locale ?? settings.locale),
      },
      canUseTool,
      permissionMode: 'default',
      mcpServers,
      spawnClaudeCodeProcess,
    };
    if (opts.resumeId) options.resume = opts.resumeId;
    const model = opts.model ?? (opts.coding ? settings.codingModel : undefined);
    if (model) options.model = model;

    const out = new AsyncQueue<AgentEvent>();
    const html = new HtmlWriteTracker(opts.cwd);
    let lastText = '';
    const consume = async () => {
      try {
        for await (const msg of query({ prompt: opts.task, options }) as AsyncIterable<SDKMessage>) {
          for (const ev of mapClaudeMessage(msg)) {
            if (ev.type === 'text') lastText = ev.text;
            out.push(ev);
          }
          html.observe(msg);
          if (msg.type === 'result') {
            const text = msg.subtype === 'success' ? msg.result || lastText : `Claude stopped: ${msg.subtype}`;
            const isError = msg.subtype !== 'success' || msg.is_error;
            out.push(html.last ? { type: 'result', text, isError, url: html.last } : { type: 'result', text, isError });
          }
        }
        out.push({ type: 'exit', code: 0 });
      } catch (e) {
        const aborted = opts.signal.aborted;
        out.push({
          type: 'result',
          text: aborted ? 'Stopped.' : `Claude failed: ${(e as Error).message}`,
          isError: true,
        });
        out.push({ type: 'exit', code: aborted ? 130 : 1 });
      } finally {
        opts.signal.removeEventListener('abort', onAbort);
        out.close();
      }
    };
    void consume();
    yield* out;
  }
}

/** Maps one SDK message to Jarvis agent events. */
export function mapClaudeMessage(msg: SDKMessage): AgentEvent[] {
  const out: AgentEvent[] = [];
  if (msg.type === 'system' && msg.subtype === 'init') {
    out.push({ type: 'session-id', id: msg.session_id });
  } else if (msg.type === 'assistant' && !msg.parent_tool_use_id) {
    if (msg.error === 'rate_limit' || msg.error === 'billing_error') {
      out.push({ type: 'activity', text: 'Claude usage limit reached' });
    }
    for (const block of msg.message.content as { type: string; text?: string; name?: string; input?: unknown }[]) {
      if (block.type === 'text' && block.text?.trim()) {
        const t = block.text.trim();
        out.push({ type: 'text', text: t });
        if (t.length <= 200 && !t.includes('\n')) out.push({ type: 'narration', text: t });
      } else if (block.type === 'tool_use' && block.name) {
        out.push({ type: 'activity', text: activityFor(block.name, (block.input ?? {}) as Record<string, unknown>) });
      }
    }
  }
  return out;
}

/**
 * Tracks .html files the agent wrote. A write counts only once its tool_result came back without error
 * (i.e. it was allowed and succeeded) and the file lies inside the session folder.
 */
export class HtmlWriteTracker {
  private readonly pending = new Map<string, string>();
  last: string | undefined;

  constructor(private readonly cwd: string) {}

  observe(msg: SDKMessage): void {
    if (msg.type === 'assistant') {
      for (const block of msg.message.content as {
        type: string;
        id?: string;
        name?: string;
        input?: { file_path?: unknown };
      }[]) {
        if (block.type !== 'tool_use' || !block.id || (block.name !== 'Write' && block.name !== 'Edit')) continue;
        const p = block.input?.file_path;
        if (typeof p === 'string' && ['.html', '.htm'].includes(extname(p).toLowerCase()))
          this.pending.set(block.id, p);
      }
    } else if (msg.type === 'user') {
      const content = msg.message.content;
      if (!Array.isArray(content)) return;
      for (const block of content as { type: string; tool_use_id?: string; is_error?: boolean }[]) {
        if (block.type !== 'tool_result' || !block.tool_use_id) continue;
        const p = this.pending.get(block.tool_use_id);
        this.pending.delete(block.tool_use_id);
        if (p && block.is_error !== true) {
          const safe = safeOpenable(p, this.cwd);
          if (safe?.kind === 'path') this.last = safe.target;
        }
      }
    }
  }
}
