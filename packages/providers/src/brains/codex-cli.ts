/**
 * `codex` brain — Codex CLI (`codex exec`) billed to the user's ChatGPT subscription via Codex login.
 *
 *   codex exec -c model_reasoning_effort="low" --json --skip-git-repo-check --ephemeral --sandbox read-only --color never
 *              [--output-schema <tmpfile>] -          (prompt on stdin)
 *
 * Output is JSONL; the reply is the last `item.completed` agent message. OPENAI_API_KEY and
 * CODEX_API_KEY are removed from the child env so the subscription login is used, never a paid key.
 */
import {
  type BrainProvider,
  type BrainRequest,
  type BrainResponse,
  ProviderError,
  type ProviderStatus,
} from '@jarvis/core';
import type { ProviderDeps } from '../deps.js';
import { tryParseJson } from '../util/json.js';
import { findCli, runProcess, sanitizedEnv, toLaunch } from '../util/process.js';
import { classifyCliFailure, mapProcessError, privateTempDir, systemText, tail, transcript } from './cli-common.js';

const ID = 'codex';
/**
 * `codex exec` boots a full agent (~20k-token system prompt); measured 40–80 s per call with a
 * ChatGPT login in Oct 2026, so it gets a longer budget than the other brains.
 */
const TIMEOUT_MS = 120_000;
export const CODEX_STRIPPED_ENV = ['OPENAI_API_KEY', 'CODEX_API_KEY'] as const;

export interface CodexParse {
  text: string;
  error?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** Parses `codex exec --json` JSONL output. */
export function parseCodexJsonl(stdout: string): CodexParse {
  const out: CodexParse = { text: '' };
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const item = ev.item as { type?: string; text?: string } | undefined;
    if (ev.type === 'item.completed' && item?.type === 'agent_message' && typeof item.text === 'string')
      out.text = item.text;
    else if (ev.type === 'turn.completed') {
      const u = ev.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      if (u) out.usage = { inputTokens: u.input_tokens, outputTokens: u.output_tokens };
    } else if (ev.type === 'turn.failed') {
      out.error = (ev.error as { message?: string } | undefined)?.message ?? 'turn failed';
    } else if (ev.type === 'error' && typeof ev.message === 'string') {
      out.error = ev.message;
    }
  }
  return out;
}

export class CodexCliBrain implements BrainProvider {
  readonly id = ID;
  readonly label = 'Codex (your ChatGPT subscription)';

  constructor(private readonly deps: ProviderDeps) {}

  private env(): NodeJS.ProcessEnv {
    return sanitizedEnv(CODEX_STRIPPED_ENV);
  }

  cliPath(): string | null {
    return findCli('codex', this.deps.settings().codexPath);
  }

  async status(): Promise<ProviderStatus> {
    const primary = this.deps.settings().primaryBrain === ID;
    const path = this.cliPath();
    if (!path) return { id: ID, connected: false, state: 'not-installed', primary };
    try {
      const launch = toLaunch(path);
      const ver = await runProcess(launch, ['--version'], { env: this.env(), timeoutMs: 10_000 });
      if (ver.code !== 0) return { id: ID, connected: false, state: 'error', primary };
      const login = await runProcess(launch, ['login', 'status'], { env: this.env(), timeoutMs: 10_000 });
      const text = `${login.stdout}\n${login.stderr}`;
      if (login.code !== 0 || /not logged in/i.test(text))
        return { id: ID, connected: false, state: 'needs-login', primary };
      const st: ProviderStatus = { id: ID, connected: true, state: 'ok', primary, account: ver.stdout.trim() };
      if (/chatgpt/i.test(text)) st.plan = 'ChatGPT';
      else if (/api key/i.test(text)) {
        // An API-key login would bill per call: report it so the UI can warn (R10).
        st.plan = 'API key';
      }
      return st;
    } catch (err) {
      this.deps.logger.warn('codex: status check failed', { error: err instanceof Error ? err.message : String(err) });
      return { id: ID, connected: false, state: 'error', primary };
    }
  }

  async complete(req: BrainRequest): Promise<BrainResponse> {
    if (req.images?.length) throw new ProviderError('Codex (exec mode) cannot read images', 'not-configured', ID);
    const path = this.cliPath();
    if (!path) throw new ProviderError('Codex CLI not found', 'not-configured', ID);
    const tmp = await privateTempDir('jarvis-codex-');
    try {
      const args = [
        'exec',
        '-c',
        'model_reasoning_effort="low"',
        '--json',
        '--skip-git-repo-check',
        '--ephemeral',
        '--sandbox',
        'read-only',
        '--color',
        'never',
      ];
      if (req.jsonSchema) args.push('--output-schema', await tmp.write('schema.json', JSON.stringify(req.jsonSchema)));
      args.push('-');
      const sys = systemText(req.messages);
      const prompt = sys ? `${sys}\n\n---\n\n${transcript(req.messages)}` : transcript(req.messages);
      const res = await runProcess(toLaunch(path), args, {
        stdin: prompt,
        env: this.env(),
        cwd: tmp.dir,
        timeoutMs: TIMEOUT_MS,
        signal: req.signal,
      });
      const parsed = parseCodexJsonl(res.stdout);
      if (parsed.error || res.code !== 0 || !parsed.text) {
        const detail = parsed.error ?? tail(res.stderr || res.stdout);
        throw new ProviderError(`Codex CLI error: ${detail || 'empty reply'}`, classifyCliFailure(detail), ID);
      }
      const out: BrainResponse = { text: parsed.text };
      if (parsed.usage) out.usage = parsed.usage;
      if (req.jsonSchema) {
        const json = tryParseJson(parsed.text);
        if (json !== undefined) out.json = json;
      } else req.onDelta?.(parsed.text);
      return out;
    } catch (err) {
      throw mapProcessError(err, ID);
    } finally {
      await tmp.cleanup();
    }
  }
}
