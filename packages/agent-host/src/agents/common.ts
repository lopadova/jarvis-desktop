/** Shared pieces for agent drivers: guidance, executable discovery, env hygiene and the permission gate. */
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, join, resolve } from 'node:path';
import {
  type AgentRunOptions,
  type ApprovalKind,
  classifyRisk,
  gate,
  type Locale,
  type RiskInput,
  type RiskLevel,
} from '@jarvis/core';
import { AGENT_DROPPED_KEYS, safeChildEnv } from '../child-env.js';
import { isInside } from '../util.js';

/** Extra, optional run options understood by the agent-host's own drivers. */
export interface HostRunExtras {
  sessionId?: string;
  /** Reports the spawned process so it can be killed as a tree and reaped after a crash (R7). */
  onProcess?: (pid: number, startTime: number) => void;
  /** Model hint for the "coding" tier. */
  coding?: boolean;
  locale?: Locale;
  /** Per-session token for Jarvis' own MCP server (see mcp-tokens.ts). */
  mcpSessionToken?: string;
}
export type HostRunOptions = AgentRunOptions & HostRunExtras;

/** Voice-friendly behaviour appended to coding agents' system prompts. */
export function voiceGuidance(locale: Locale): string {
  const lang = locale === 'it' ? 'Italian' : 'English';
  return [
    'You are running headless on behalf of Jarvis, a voice assistant. The user hears short spoken updates, not your full output.',
    `- Before each major step write ONE short plain sentence saying what you are about to do (no markdown), in ${lang} or in the language of the task.`,
    '- Finish with a one-sentence summary of the outcome in the language of the task.',
    '- Start long-running servers (dev servers, watchers) detached/in the background so the task can finish; report the local URL.',
    '- Never ask the user questions in your output: nobody reads it live. If you are truly blocked and need a decision, call the MCP tool `jarvis_ask_user` (server "jarvis") and wait for the answer.',
    '- Risky actions are reviewed by the user through Jarvis; if one is denied, choose a safer alternative or stop and explain.',
  ].join('\n');
}

export function composeGuidance(opts: AgentRunOptions, locale: Locale): string {
  return [voiceGuidance(locale), opts.guidance].filter((s) => s?.trim()).join('\n\n');
}

/** Environment for agent children: allowlisted, no JARVIS_* secrets, no pay-per-use keys (R6, R10). */
export function childEnv(extra: Record<string, string> = {}): Record<string, string> {
  return safeChildEnv(extra, { drop: AGENT_DROPPED_KEYS });
}

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/**
 * Finds an executable: explicit setting → PATH (with PATHEXT on Windows) → common install dirs.
 * Native executables are preferred over `.cmd` shims on Windows (shims need a shell to run).
 */
export function discoverExecutable(
  name: string,
  configured: string,
  extraDirs: string[],
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (configured) return existsSync(configured) ? configured : null;
  const exts = platform === 'win32' ? ['.exe', ''] : [''];
  const dirs = [...(env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean), ...extraDirs];
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = join(dir, name + ext);
      if (isFile(p)) return p;
    }
  }
  return null;
}

export function commonBinDirs(): string[] {
  const h = homedir();
  return [
    join(h, '.local', 'bin'),
    join(h, '.claude', 'local'),
    join(h, '.bun', 'bin'),
    join(h, '.npm-global', 'bin'),
    join(h, 'AppData', 'Roaming', 'npm'),
    join(h, 'AppData', 'Local', 'Programs', 'claude'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
  ];
}

// ───────── permission policy for tool requests ─────────

export interface ToolRequest {
  kind: ApprovalKind;
  title: string;
  detail: string;
  risk: RiskInput;
  /** Ask the user regardless of the project permission level (e.g. agents using Jarvis' own write tools). */
  forceAsk?: boolean;
  /** Floor for the classified risk (e.g. a command that also asks for network access). */
  minRisk?: RiskLevel;
  /** Ignore the project's shell allowlist (an allowlisted command never implies extra permissions). */
  skipAllowlist?: boolean;
}

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };
export const maxRisk = (a: RiskLevel, b?: RiskLevel): RiskLevel => (b && RISK_ORDER[b] > RISK_ORDER[a] ? b : a);

/** Jarvis' own MCP tools an agent may use without asking (they cannot escalate privileges). */
export const AGENT_SAFE_JARVIS_TOOLS = new Set([
  'jarvis_ask_user',
  'jarvis_speak',
  'jarvis_notify',
  'jarvis_list_sessions',
  'jarvis_session_result',
  'jarvis_recall',
]);

/**
 * Jarvis' own write tools gated by the MCP handler itself (click approval for EVERY caller), so they
 * are let through here to avoid asking twice. The handler is the single gate: an agent could reach
 * mcp.call directly with its session token, bypassing canUseTool.
 */
export const HANDLER_GATED_JARVIS_TOOLS = new Set(['jarvis_start_task', 'jarvis_remember']);

/** An agent calling Jarvis' own MCP server. Known tools are allowed (see above); unknown ones ask. */
export function describeJarvisTool(tool: string, _input: Record<string, unknown>): ToolRequest | 'allow' {
  if (AGENT_SAFE_JARVIS_TOOLS.has(tool) || HANDLER_GATED_JARVIS_TOOLS.has(tool)) return 'allow';
  return {
    kind: 'mcp-tool',
    title: `use ${tool}`,
    detail: tool,
    risk: { kind: 'mcp-tool', detail: tool },
    forceAsk: true,
  };
}

const READ_ONLY_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'LS',
  'TodoWrite',
  'Task',
  'Agent',
  'NotebookRead',
  'ExitPlanMode',
  'BashOutput',
  'KillShell',
  'KillBash',
  'ToolSearch',
  'Skill',
]);

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Maps a Claude Code tool call to an approval request. Returns 'allow' for read-only tools and for
 * Jarvis' own MCP tools (which enforce their own policy).
 */
export function describeClaudeTool(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string,
  blockedPath?: string,
): ToolRequest | 'allow' {
  if (toolName.startsWith('mcp__jarvis__')) return describeJarvisTool(toolName.slice('mcp__jarvis__'.length), input);
  if (READ_ONLY_TOOLS.has(toolName) && !blockedPath) return 'allow';
  switch (toolName) {
    case 'Bash':
    case 'PowerShell': {
      const cmd = str(input.command);
      return { kind: 'shell', title: 'run a shell command', detail: cmd, risk: { kind: 'shell', detail: cmd } };
    }
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const p = str(input.file_path) || str(input.notebook_path) || blockedPath || '';
      const inside = p ? isInside(cwd, resolve(cwd, p)) : false;
      return {
        kind: 'file-write',
        title: `edit ${basename(p) || 'a file'}`,
        detail: p,
        risk: { kind: 'file-write', detail: p, insideProject: inside },
      };
    }
    case 'WebFetch': {
      const url = str(input.url);
      return {
        kind: 'network',
        title: 'open a web page',
        detail: `GET ${url}`,
        risk: { kind: 'network', detail: `GET ${url}` },
      };
    }
    case 'WebSearch': {
      const q = str(input.query);
      return {
        kind: 'network',
        title: 'search the web',
        detail: `GET search: ${q}`,
        risk: { kind: 'network', detail: `GET ${q}` },
      };
    }
    default: {
      if (blockedPath) {
        return {
          kind: 'file-write',
          title: `access ${basename(blockedPath)} outside the project`,
          detail: blockedPath,
          risk: { kind: 'file-write', detail: blockedPath, insideProject: false },
        };
      }
      return {
        kind: 'mcp-tool',
        title: `use the tool ${toolName.replace(/^mcp__/, '').replace(/__/g, ' → ')}`,
        detail: toolName,
        risk: { kind: 'mcp-tool', detail: toolName },
      };
    }
  }
}

export type ToolVerdict = { allow: true } | { allow: false; message: string };

/** classifyRisk → gate → (ask the user). Shared by every driver. */
export async function decideTool(req: ToolRequest, opts: AgentRunOptions): Promise<ToolVerdict> {
  const risk = maxRisk(classifyRisk(req.risk), req.minRisk);
  const g = req.forceAsk ? 'ask' : gate(opts.permission, risk, req.risk, req.skipAllowlist ? [] : opts.allowlist);
  if (g === 'allow') return { allow: true };
  if (g === 'deny') return { allow: false, message: 'Blocked by the project permission policy.' };
  const decision = await opts.requestApproval({
    kind: req.kind,
    risk,
    title: req.title,
    detail: req.detail,
    cwd: opts.cwd,
  });
  return decision === 'deny'
    ? { allow: false, message: 'The user denied this action. Choose a safer alternative or stop.' }
    : { allow: true };
}

/** Short spoken-style activity line for a tool call. */
export function activityFor(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash':
    case 'PowerShell':
      return `Running ${str(input.description) || str(input.command).slice(0, 60)}`;
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return `Editing ${basename(str(input.file_path))}`;
    case 'Read':
      return `Reading ${basename(str(input.file_path))}`;
    case 'Grep':
    case 'Glob':
      return 'Searching the code';
    case 'WebFetch':
      return `Reading ${safeHost(str(input.url))}`;
    case 'WebSearch':
      return 'Searching the web';
    default:
      return `Using ${toolName.replace(/^mcp__/, '').replace(/__/g, ' ')}`;
  }
}

function safeHost(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return 'a web page';
  }
}

/** Single-consumer async queue used to bridge callbacks into an async iterator. */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private waiter: ((r: IteratorResult<T>) => void) | null = null;
  private closed = false;
  push(item: T): void {
    if (this.closed) return;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w({ value: item, done: false });
    } else this.items.push(item);
  }
  close(): void {
    this.closed = true;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w({ value: undefined as never, done: true });
    }
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift() as T, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((r) => {
          this.waiter = r;
        });
      },
    };
  }
}
