/**
 * Codex over `codex app-server` (JSON-RPC, one JSON object per line on stdio). Unlike the TypeScript
 * SDK, the app-server asks the client before risky actions, so Codex goes through the same policy as
 * Claude (R1/R2): every approval request → describe → classifyRisk → gate → Jarvis approval.
 *
 * Verified against codex-cli 0.159 (`codex app-server generate-ts` + live probes):
 *  - handshake: `initialize` {clientInfo, capabilities} → `initialized` notification;
 *  - `thread/start` | `thread/resume` {threadId} with cwd, approvalPolicy, sandbox, config, developerInstructions;
 *  - `turn/start` {threadId, input:[{type:'text', text, text_elements:[]}]}, `turn/interrupt` {threadId, turnId};
 *  - server requests: `item/commandExecution/requestApproval` → {decision: accept|decline},
 *    `item/fileChange/requestApproval` (paths come from the matching `fileChange` item) → same,
 *    `item/permissions/requestApproval` → {permissions, scope}, `mcpServer/elicitation/request` with
 *    `_meta.codex_approval_kind = "mcp_tool_call"` for MCP tool approvals → {action: accept|decline},
 *    legacy `execCommandApproval` / `applyPatchApproval` → {decision: approved | {denied}}.
 *
 * Policy: approvalPolicy `untrusted` at every level, so Codex asks for anything outside its built-in
 * read-only command list and Jarvis decides; sandbox `workspace-write` (edits inside the project are
 * allowed by R1), network only for full-auto. Anything we cannot classify is declined.
 * Process: own process group on Unix, tree kill on stop, PID + start time reported for orphan reaping
 * (R7). Env: allowlisted, no pay-per-use keys (R6/R10). The Jarvis MCP server (with the per-session
 * token) is attached through the `config` field of `thread/start`, which travels over stdin, never argv.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { AgentEvent, Logger, PermissionLevel, Settings } from '@jarvis/core';
import { isInside } from '../util.js';
import type { McpCommand } from './claude.js';
import {
  AsyncQueue,
  childEnv,
  composeGuidance,
  decideTool,
  describeJarvisTool,
  type HostRunOptions,
  type ToolRequest,
} from './common.js';
import { JsonlRpcPeer, JsonRpcError } from './jsonl-rpc.js';

export interface Launch {
  command: string;
  args: string[];
}

/** Thrown when the app-server cannot be used at all (old CLI, crash before the thread starts). */
export class AppServerUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppServerUnavailable';
  }
}

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/**
 * Finds the native Codex binary of an npm install on Windows, so the app-server is spawned without a
 * shell and without the Node launcher in between (a direct child is what we kill and put in a job).
 */
export function findNativeCodex(npmBinDir: string, arch: string = process.arch): string | null {
  const pkg = join(npmBinDir, 'node_modules', '@openai', 'codex');
  const triple = arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  const plat = `codex-win32-${arch === 'arm64' ? 'arm64' : 'x64'}`;
  const candidates = [
    join(pkg, 'node_modules', '@openai', plat, 'vendor', triple, 'bin', 'codex.exe'),
    join(pkg, 'node_modules', '@openai', plat, 'vendor', triple, 'codex', 'codex.exe'),
    join(pkg, 'vendor', triple, 'bin', 'codex.exe'),
    join(pkg, 'vendor', triple, 'codex', 'codex.exe'),
  ];
  return candidates.find(isFile) ?? null;
}

/** Turns a discovered Codex path into a shell-free launch of `codex app-server`. */
export function codexAppServerLaunch(
  exe: string,
  platform: NodeJS.Platform = process.platform,
  nodePath: string = process.execPath,
): Launch | null {
  const ext = extname(exe).toLowerCase();
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return { command: nodePath, args: [exe, 'app-server'] };
  if (platform !== 'win32' || ext === '.exe') return { command: exe, args: ['app-server'] };
  // Windows npm shims (`codex`, `codex.cmd`, `codex.ps1`) need a shell; use the real binary instead.
  const native = findNativeCodex(dirname(resolve(exe)));
  if (native) return { command: native, args: ['app-server'] };
  const script = join(dirname(resolve(exe)), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  return isFile(script) ? { command: nodePath, args: [script, 'app-server'] } : null;
}

export interface CodexThreadPolicy {
  approvalPolicy: 'untrusted';
  sandbox: 'workspace-write';
  network: boolean;
}

/** Same policy at every level: Codex asks, Jarvis decides (gate); only full-auto gets sandbox network. */
export function codexAppServerPolicy(level: PermissionLevel): CodexThreadPolicy {
  return { approvalPolicy: 'untrusted', sandbox: 'workspace-write', network: level === 'full-auto' };
}

// ───────── approval mapping ─────────

interface FileChangeItem {
  type: 'fileChange';
  id: string;
  changes: { path: string; kind?: { type?: string } }[];
}
interface McpCallItem {
  type: 'mcpToolCall';
  id: string;
  server: string;
  tool: string;
  readOnlyHint?: boolean | null;
}

export interface ApprovalContext {
  cwd: string;
  fileChanges: Map<string, FileChangeItem>;
  /** In-flight MCP tool calls by item id (added on item/started, removed on item/completed). */
  mcpCalls: Map<string, McpCallItem>;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const allInside = (abs: string[], cwd: string): boolean => abs.length > 0 && abs.every((p) => isInside(cwd, p));

function fileWriteRequest(paths: string[], cwd: string, deleting: boolean): ToolRequest {
  const abs = paths.map((p) => resolve(cwd, p));
  const inside = allInside(abs, cwd);
  const detail = abs.join('\n') || 'unknown files';
  const name = abs.length === 1 ? basename(abs[0] as string) : `${abs.length || 'some'} files`;
  const kind = deleting ? 'file-delete' : 'file-write';
  return {
    kind,
    title: deleting ? `delete ${name}` : `edit ${name}`,
    detail,
    risk: { kind, detail, insideProject: inside },
  };
}

/**
 * `item/permissions/requestApproval`: ONE approval that names every requested capability (writes,
 * reads with full paths, network), and a grant of exactly what was described. Paths outside the
 * project make the request high risk (click only, R2).
 */
function permissionsRequest(
  perms: Record<string, unknown>,
  reason: string,
  cwd: string,
): { req: ToolRequest; granted: Record<string, unknown> } {
  const fs = perms.fileSystem ? obj(perms.fileSystem) : null;
  const net = perms.network ? obj(perms.network) : null;
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => resolve(cwd, String(x))) : []);
  const writes = fs ? list(fs.write) : [];
  const reads = fs ? list(fs.read) : [];
  const entries = fs && Array.isArray(fs.entries) ? fs.entries.length : 0;
  const wantsNetwork = net?.enabled === true;
  const lines: string[] = [];
  if (writes.length) lines.push(`write: ${writes.join(', ')}`);
  if (reads.length) lines.push(`read: ${reads.join(', ')}`);
  if (entries) lines.push(`${entries} more file system rule(s): ${JSON.stringify(fs?.entries).slice(0, 600)}`);
  if (wantsNetwork) lines.push('network access');
  if (reason) lines.push(`reason: ${reason}`);
  const detail = lines.join('\n') || 'unspecified permissions';
  const paths = [...writes, ...reads];
  const outside = entries > 0 || (paths.length > 0 && !allInside(paths, cwd));
  const parts = [
    writes.length ? 'write files' : '',
    reads.length ? 'read files' : '',
    wantsNetwork ? 'use the network' : '',
  ]
    .filter(Boolean)
    .join(', ');
  const title = `get permission to ${parts || 'do more'}`;
  // Grant exactly what the approval described, nothing else.
  const granted: Record<string, unknown> = {};
  if (wantsNetwork) granted.network = { enabled: true };
  if (fs && (writes.length || reads.length || entries)) granted.fileSystem = fs;
  let req: ToolRequest;
  if (outside || (!wantsNetwork && !paths.length)) {
    req = { kind: 'file-write', title, detail, risk: { kind: 'file-write', detail, insideProject: false } };
  } else if (wantsNetwork) {
    req = { kind: 'network', title, detail, risk: { kind: 'network', detail } };
  } else {
    req = { kind: 'file-write', title, detail, risk: { kind: 'file-write', detail, insideProject: true } };
  }
  return { req, granted };
}

function shellRequest(command: string, reason: string, network: { host?: string } | null): ToolRequest {
  if (network?.host) {
    const d = `network access to ${network.host}${command ? ` for: ${command}` : ''}`;
    return { kind: 'network', title: `connect to ${network.host}`, detail: d, risk: { kind: 'network', detail: d } };
  }
  const detail = command || reason || 'an unspecified command';
  return { kind: 'shell', title: 'run a shell command', detail, risk: { kind: 'shell', detail } };
}

export type CodexApprovalMapping =
  | { kind: 'ask'; req: ToolRequest; respond: (allow: boolean) => unknown }
  | { kind: 'allow'; respond: (allow: boolean) => unknown }
  | { kind: 'refuse'; result: unknown }
  | { kind: 'unsupported' };

/** Maps one app-server → client request to a Jarvis permission request and the response shape. */
export function mapCodexServerRequest(method: string, params: unknown, ctx: ApprovalContext): CodexApprovalMapping {
  const p = obj(params);
  const accept = (allow: boolean) => ({ decision: allow ? 'accept' : 'decline' });
  const review = (allow: boolean) => ({
    decision: allow ? 'approved' : { denied: { rejection: 'The user denied this action.' } },
  });
  switch (method) {
    case 'item/commandExecution/requestApproval': {
      const net = p.networkApprovalContext ? { host: str(obj(p.networkApprovalContext).host) } : null;
      const command = str(p.command);
      return { kind: 'ask', req: shellRequest(command, str(p.reason), net), respond: accept };
    }
    case 'item/fileChange/requestApproval': {
      const item = ctx.fileChanges.get(str(p.itemId));
      const paths = item?.changes.map((c) => c.path) ?? [];
      if (!paths.length && str(p.grantRoot)) paths.push(str(p.grantRoot));
      const deleting = !!item?.changes.some((c) => c.kind?.type === 'delete');
      return { kind: 'ask', req: fileWriteRequest(paths, ctx.cwd, deleting), respond: accept };
    }
    case 'item/permissions/requestApproval': {
      const { req, granted } = permissionsRequest(obj(p.permissions), str(p.reason), ctx.cwd);
      return { kind: 'ask', req, respond: (allow: boolean) => ({ permissions: allow ? granted : {}, scope: 'turn' }) };
    }
    case 'mcpServer/elicitation/request': {
      const meta = obj(p._meta);
      const decline = { action: 'decline', content: null, _meta: null };
      if (meta.codex_approval_kind !== 'mcp_tool_call') return { kind: 'refuse', result: decline };
      const server = str(p.serverName);
      // The elicitation names the tool (source of truth) but carries no call id (codex-cli 0.159), so
      // the in-flight call is matched by server + tool. Only an unambiguous match may use per-call
      // facts (auto-allow of Jarvis' own tools, readOnlyHint); anything else asks the user.
      const tool = /tool "([^"]+)"/.exec(str(p.message))?.[1] ?? '';
      const inFlight = [...ctx.mcpCalls.values()].filter((c) => c.server === server);
      if (tool && inFlight.length > 0 && !inFlight.some((c) => c.tool === tool)) {
        // The approval names a tool that is not running on that server: never approve a mismatch.
        return { kind: 'refuse', result: decline };
      }
      const identified = tool && inFlight.length === 1 ? inFlight[0] : undefined;
      const respond = (allow: boolean) => (allow ? { action: 'accept', content: {}, _meta: null } : decline);
      const detail = `mcp__${server}__${tool || 'unknown_tool'}`;
      const ask: ToolRequest = {
        kind: 'mcp-tool',
        title: `use the tool ${server} → ${tool || 'an unknown tool'}`,
        detail,
        risk: { kind: 'mcp-tool', detail, ...(identified?.readOnlyHint === true ? { readOnlyHint: true } : {}) },
      };
      if (server === 'jarvis') {
        if (!identified) return { kind: 'ask', req: { ...ask, forceAsk: true }, respond };
        const d = describeJarvisTool(tool, obj(meta.tool_params));
        return d === 'allow' ? { kind: 'allow', respond } : { kind: 'ask', req: d, respond };
      }
      return { kind: 'ask', req: identified ? ask : { ...ask, forceAsk: true }, respond };
    }
    case 'execCommandApproval': {
      const cmd = Array.isArray(p.command) ? p.command.map(String).join(' ') : str(p.command);
      return { kind: 'ask', req: shellRequest(cmd, str(p.reason), null), respond: review };
    }
    case 'applyPatchApproval': {
      const changes = obj(p.fileChanges);
      const deleting = Object.values(changes).some((c) => obj(c).type === 'delete');
      return { kind: 'ask', req: fileWriteRequest(Object.keys(changes), ctx.cwd, deleting), respond: review };
    }
    default:
      return { kind: 'unsupported' };
  }
}

// ───────── event mapping ─────────

export function mapAppServerNotification(method: string, params: unknown, ctx: ApprovalContext): AgentEvent[] {
  const p = obj(params);
  const item = obj(p.item);
  switch (method) {
    case 'item/started': {
      switch (item.type) {
        case 'commandExecution': {
          const actions = Array.isArray(item.commandActions) ? item.commandActions.map(obj) : [];
          const shown = str(actions[0]?.command) || str(item.command);
          return [{ type: 'activity', text: `Running ${shown.slice(0, 60)}` }];
        }
        case 'fileChange': {
          const fc = item as unknown as FileChangeItem;
          if (Array.isArray(fc.changes)) ctx.fileChanges.set(fc.id, fc);
          const first = fc.changes?.[0]?.path;
          return first ? [{ type: 'activity', text: `Editing ${basename(first)}` }] : [];
        }
        case 'mcpToolCall': {
          const mc = item as unknown as McpCallItem;
          ctx.mcpCalls.set(mc.id, mc);
          return [{ type: 'activity', text: `Using ${mc.server} ${mc.tool}` }];
        }
        case 'webSearch':
          return [{ type: 'activity', text: 'Searching the web' }];
        default:
          return [];
      }
    }
    case 'item/completed': {
      if (item.type === 'fileChange') ctx.fileChanges.delete(str(item.id));
      if (item.type === 'mcpToolCall') ctx.mcpCalls.delete(str(item.id));
      if (item.type !== 'agentMessage') return [];
      const t = str(item.text).trim();
      if (!t) return [];
      return t.length <= 200 && !t.includes('\n')
        ? [
            { type: 'text', text: t },
            { type: 'narration', text: t },
          ]
        : [{ type: 'text', text: t }];
    }
    default:
      return [];
  }
}

// ───────── driver ─────────

export interface AppServerRunDeps {
  settings: () => Settings;
  logger: Logger;
  mcpCommand?: () => McpCommand | null;
  /** Kills the app-server process tree (R7). */
  killTree: (pid: number) => Promise<void>;
  /** Injectable for tests. */
  spawnProcess?: (launch: Launch, cwd: string, env: Record<string, string>) => ChildProcess;
  timeouts?: { handshakeMs?: number; threadMs?: number };
}

const CLIENT_INFO = { name: 'jarvis_desktop', title: 'Jarvis Desktop', version: '0.1.0' };

/** Runs one Codex turn through the app-server. Throws AppServerUnavailable before the thread starts. */
export async function* runCodexAppServer(
  launch: Launch,
  opts: HostRunOptions,
  deps: AppServerRunDeps,
): AsyncIterable<AgentEvent> {
  const settings = deps.settings();
  const env = childEnv();
  const child = deps.spawnProcess
    ? deps.spawnProcess(launch, opts.cwd, env)
    : spawn(launch.command, launch.args, {
        cwd: opts.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
  const out = new AsyncQueue<AgentEvent>();
  const ctx: ApprovalContext = { cwd: opts.cwd, fileChanges: new Map(), mcpCalls: new Map() };
  let threadId = '';
  let turnId = '';
  let lastMessage = '';
  let finished = false;
  let exited = false;
  let stderrTail = '';

  const spawnError = new Promise<Error>((resolveErr) => {
    child.once('error', (e) => resolveErr(e));
    child.once('exit', (code, signal) => {
      exited = true;
      resolveErr(new Error(`codex app-server exited (${signal ?? code})`));
    });
  });
  if (child.pid) opts.onProcess?.(child.pid, Date.now());
  child.stderr?.on('data', (d: Buffer) => {
    stderrTail = (stderrTail + d.toString()).slice(-2000);
    deps.logger.debug('codex app-server stderr', { text: d.toString().slice(0, 500) });
  });
  const stdout = child.stdout;
  const stdin = child.stdin;
  if (!stdout || !stdin) throw new AppServerUnavailable('codex app-server has no stdio');

  const finish = (ev: AgentEvent) => {
    if (finished) return;
    finished = true;
    out.push(ev);
    out.close();
  };

  const peer = new JsonlRpcPeer(stdout, stdin, {
    onNotification: (method, params) => {
      const p = obj(params);
      if (threadId && str(p.threadId) && str(p.threadId) !== threadId) return;
      if (method === 'turn/started') turnId = str(obj(p.turn).id) || turnId;
      for (const ev of mapAppServerNotification(method, params, ctx)) {
        if (ev.type === 'text') lastMessage = ev.text;
        out.push(ev);
      }
      if (method === 'turn/completed') {
        const turn = obj(p.turn);
        const status = str(turn.status);
        if (status === 'completed') finish({ type: 'result', text: lastMessage, isError: false });
        else if (status === 'interrupted') finish({ type: 'result', text: 'Stopped.', isError: true });
        else
          finish({
            type: 'result',
            text: `Codex failed: ${str(obj(turn.error).message) || status || 'unknown error'}`,
            isError: true,
          });
      } else if (method === 'error' && p.willRetry !== true) {
        out.push({ type: 'activity', text: `Codex error: ${str(obj(p.error).message).slice(0, 100)}` });
      }
    },
    onRequest: async (method, params) => {
      const m = mapCodexServerRequest(method, params, ctx);
      if (m.kind === 'unsupported') {
        deps.logger.info('codex app-server request not supported', { method });
        throw new JsonRpcError(-32601, `Jarvis does not support ${method}`);
      }
      if (m.kind === 'refuse') return m.result;
      if (m.kind === 'allow') return m.respond(true);
      if (opts.signal.aborted) return m.respond(false);
      const v = await decideTool(m.req, opts);
      return m.respond(v.allow && !opts.signal.aborted);
    },
    onProtocolError: (detail) => deps.logger.warn('codex app-server protocol error', { detail }),
  });

  let killed = false;
  const kill = () => {
    if (killed || !child.pid) return;
    killed = true;
    peer.close(new Error('stopped'));
    try {
      stdin.end();
    } catch {
      /* already closed */
    }
    void deps.killTree(child.pid).catch(() => undefined);
  };
  const onAbort = () => {
    if (threadId && turnId) void peer.request('turn/interrupt', { threadId, turnId }, 3_000).catch(() => undefined);
    const t = setTimeout(kill, 2_000);
    t.unref?.();
    finish({ type: 'result', text: 'Stopped.', isError: true });
  };
  opts.signal.addEventListener('abort', onAbort, { once: true });
  if (opts.signal.aborted) onAbort();

  const race = <T>(p: Promise<T>): Promise<T> =>
    Promise.race([p, spawnError.then((e) => Promise.reject(e))]) as Promise<T>;

  try {
    // ── handshake + thread: failures here mean "app-server unavailable" (the caller falls back)
    try {
      await race(
        peer.request(
          'initialize',
          { clientInfo: CLIENT_INFO, capabilities: null },
          deps.timeouts?.handshakeMs ?? 20_000,
        ),
      );
      peer.notify('initialized');
      const policy = codexAppServerPolicy(opts.permission);
      const config: Record<string, unknown> = {};
      if (policy.network) config.sandbox_workspace_write = { network_access: true };
      const mcp = deps.mcpCommand?.();
      if (mcp) {
        const mcpEnv: Record<string, string> = { ...(mcp.env ?? {}) };
        if (opts.mcpSessionToken) mcpEnv.JARVIS_MCP_SESSION_TOKEN = opts.mcpSessionToken;
        config.mcp_servers = { jarvis: { command: mcp.command, args: mcp.args, env: mcpEnv } };
      }
      const threadParams: Record<string, unknown> = {
        cwd: opts.cwd,
        approvalPolicy: policy.approvalPolicy,
        approvalsReviewer: 'user',
        sandbox: policy.sandbox,
        config,
        developerInstructions: composeGuidance(opts, opts.locale ?? settings.locale),
      };
      if (opts.model) threadParams.model = opts.model;
      const started = await race(
        peer.request<{ thread?: { id?: string } }>(
          opts.resumeId ? 'thread/resume' : 'thread/start',
          opts.resumeId ? { ...threadParams, threadId: opts.resumeId } : threadParams,
          deps.timeouts?.threadMs ?? 120_000,
        ),
      );
      threadId = str(started?.thread?.id);
      if (!threadId) throw new Error('no thread id');
    } catch (e) {
      if (opts.signal.aborted) throw e;
      kill();
      throw new AppServerUnavailable(`${(e as Error).message}${stderrTail ? ` — ${stderrTail.slice(-300)}` : ''}`);
    }
    yield { type: 'session-id', id: threadId };

    void race(
      peer.request<{ turn?: { id?: string } }>(
        'turn/start',
        { threadId, input: [{ type: 'text', text: opts.task, text_elements: [] }] },
        60_000,
      ),
    ).then(
      (r) => {
        turnId = str(r?.turn?.id) || turnId;
      },
      (e: Error) => finish({ type: 'result', text: `Codex failed: ${e.message}`, isError: true }),
    );
    void spawnError.then((e) => {
      if (!finished && !opts.signal.aborted)
        finish({ type: 'result', text: `Codex stopped unexpectedly: ${e.message}`, isError: true });
    });

    for await (const ev of out) yield ev;
    yield { type: 'exit', code: opts.signal.aborted ? 130 : 0 };
  } finally {
    opts.signal.removeEventListener('abort', onAbort);
    // After a stop the interrupt gets a short grace period (the onAbort timer kills the tree after it).
    if (!exited && !opts.signal.aborted) kill();
  }
}
