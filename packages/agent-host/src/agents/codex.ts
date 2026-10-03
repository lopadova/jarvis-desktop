/**
 * Codex driver over `@openai/codex-sdk` (threads with resume).
 *
 * Approvals: the TypeScript SDK (v0.160) exposes no approval callback. `codex app-server` sends
 * JSON-RPC approval requests, but wiring that protocol is a follow-up. Until then a fail-safe sandbox
 * mapping applies (approval policy `never`, so Codex can never escalate; see `codexSandboxFor`):
 * safe → read-only; trusted → workspace-write without network on macOS/Linux, read-only on Windows
 * (weaker sandbox); full-auto → workspace-write with network.
 * OPENAI_API_KEY is removed from the child env so the user's ChatGPT login is used (R10).
 */

import { basename } from 'node:path';
import type { AgentDriver, AgentEvent, Logger, PermissionLevel, Settings } from '@jarvis/core';
import type { Codex as CodexClass, SandboxMode, ThreadEvent, ThreadOptions } from '@openai/codex-sdk';
import { childEnv, commonBinDirs, composeGuidance, discoverExecutable, type HostRunOptions } from './common.js';

export interface CodexDriverDeps {
  settings: () => Settings;
  logger: Logger;
  /** Injectable for tests. */
  createCodex?: (opts: ConstructorParameters<typeof CodexClass>[0]) => Pick<CodexClass, 'startThread' | 'resumeThread'>;
  discover?: () => string | null;
  platform?: NodeJS.Platform;
}

export class CodexDriver implements AgentDriver {
  readonly id = 'codex' as const;
  readonly label = 'Codex';

  constructor(private readonly deps: CodexDriverDeps) {}

  executable(): string | null {
    if (this.deps.discover) return this.deps.discover();
    return discoverExecutable('codex', this.deps.settings().codexPath, commonBinDirs());
  }

  async available(): Promise<{ ok: boolean; detail: string }> {
    const exe = this.executable();
    return exe ? { ok: true, detail: exe } : { ok: false, detail: 'Codex CLI not found' };
  }

  async *run(opts: HostRunOptions): AsyncIterable<AgentEvent> {
    const exe = this.executable();
    if (!exe) {
      yield { type: 'result', text: 'Codex is not installed.', isError: true };
      yield { type: 'exit', code: 1 };
      return;
    }
    let factory = this.deps.createCodex;
    if (!factory) {
      const { Codex } = await import('@openai/codex-sdk');
      factory = (o) => new Codex(o);
    }
    const codex = factory({ codexPathOverride: exe, env: childEnv() });
    const policy = codexSandboxFor(opts.permission, this.deps.platform ?? process.platform);
    const threadOpts: ThreadOptions = {
      workingDirectory: opts.cwd,
      skipGitRepoCheck: true,
      sandboxMode: policy.sandboxMode,
      approvalPolicy: 'never',
      networkAccessEnabled: policy.network,
    };
    if (policy.notice) yield { type: 'activity', text: policy.notice };
    // Codex picks its own default model; only an explicit per-run model is forwarded.
    if (opts.model) threadOpts.model = opts.model;
    const thread = opts.resumeId ? codex.resumeThread(opts.resumeId, threadOpts) : codex.startThread(threadOpts);
    const prompt = `${composeGuidance(opts, opts.locale ?? this.deps.settings().locale)}\n\n# Task\n${opts.task}`;
    let lastMessage = '';
    try {
      const { events } = await thread.runStreamed(prompt, { signal: opts.signal });
      for await (const ev of events) {
        for (const out of mapCodexEvent(ev)) {
          if (out.type === 'text') lastMessage = out.text;
          if (out.type === 'result') {
            yield { ...out, text: out.isError ? out.text : lastMessage || out.text };
          } else yield out;
        }
      }
      yield { type: 'exit', code: 0 };
    } catch (e) {
      const aborted = opts.signal.aborted;
      yield { type: 'result', text: aborted ? 'Stopped.' : `Codex failed: ${(e as Error).message}`, isError: true };
      yield { type: 'exit', code: aborted ? 130 : 1 };
    }
  }
}

export interface CodexPolicy {
  sandboxMode: SandboxMode;
  network: boolean;
  notice?: string;
}

/**
 * Fail-safe sandbox mapping while Codex approvals are not wired (R1):
 *  - safe      → read-only (Codex can read and propose, never write or run side effects);
 *  - trusted   → workspace-write without network, but only where the OS sandbox is strong
 *                (macOS Seatbelt, Linux Landlock); on Windows → read-only;
 *  - full-auto → workspace-write with network (explicit opt-in).
 */
export function codexSandboxFor(level: PermissionLevel, platform: NodeJS.Platform): CodexPolicy {
  if (level === 'full-auto') return { sandboxMode: 'workspace-write', network: true };
  if (level === 'trusted' && (platform === 'darwin' || platform === 'linux')) {
    return { sandboxMode: 'workspace-write', network: false };
  }
  return {
    sandboxMode: 'read-only',
    network: false,
    notice:
      level === 'safe'
        ? 'In Safe mode Codex can only read — switch the project to Trusted or use Claude for edits'
        : 'On Windows Codex runs read-only in Trusted projects — use Full auto or Claude for edits',
  };
}

export function mapCodexEvent(ev: ThreadEvent): AgentEvent[] {
  switch (ev.type) {
    case 'thread.started':
      return [{ type: 'session-id', id: ev.thread_id }];
    case 'item.started': {
      const it = ev.item;
      if (it.type === 'command_execution') return [{ type: 'activity', text: `Running ${it.command.slice(0, 60)}` }];
      if (it.type === 'mcp_tool_call') return [{ type: 'activity', text: `Using ${it.server} ${it.tool}` }];
      if (it.type === 'web_search') return [{ type: 'activity', text: 'Searching the web' }];
      return [];
    }
    case 'item.completed': {
      const it = ev.item;
      if (it.type === 'agent_message' && it.text.trim()) {
        const t = it.text.trim();
        return t.length <= 200 && !t.includes('\n')
          ? [
              { type: 'text', text: t },
              { type: 'narration', text: t },
            ]
          : [{ type: 'text', text: t }];
      }
      if (it.type === 'file_change' && it.changes[0])
        return [{ type: 'activity', text: `Editing ${basename(it.changes[0].path)}` }];
      return [];
    }
    case 'turn.completed':
      return [{ type: 'result', text: '', isError: false }];
    case 'turn.failed':
      return [{ type: 'result', text: `Codex failed: ${ev.error.message}`, isError: true }];
    case 'error':
      return [{ type: 'result', text: `Codex error: ${ev.message}`, isError: true }];
    default:
      return [];
  }
}
