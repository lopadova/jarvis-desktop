/**
 * `claude` brain — Claude Code CLI in print mode, billed to the user's Claude subscription.
 *
 *   claude -p --output-format json --model haiku --tools "" --strict-mcp-config
 *          --mcp-config '{"mcpServers":{}}' --setting-sources "" --no-session-persistence
 *          --system-prompt-file <tmp> [--json-schema <schema>]      (prompt on stdin)
 *
 * The system prompt goes through a private temp file (deleted afterwards), the prompt through stdin;
 * only the static JSON Schema is on argv. ANTHROPIC_API_KEY is removed so the subscription is used.
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

const ID = 'claude';
const TIMEOUT_MS = 45_000;
export const CLAUDE_STRIPPED_ENV = ['ANTHROPIC_API_KEY'] as const;

interface ClaudeEnvelope {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  api_error_status?: number | null;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class ClaudeCliBrain implements BrainProvider {
  readonly id = ID;
  readonly label = 'Claude (your subscription)';

  constructor(private readonly deps: ProviderDeps) {}

  private env(): NodeJS.ProcessEnv {
    return { ...sanitizedEnv(CLAUDE_STRIPPED_ENV), MAX_THINKING_TOKENS: '0' };
  }

  cliPath(): string | null {
    return findCli('claude', this.deps.settings().claudePath);
  }

  async status(): Promise<ProviderStatus> {
    const primary = this.deps.settings().primaryBrain === ID;
    const path = this.cliPath();
    if (!path) return { id: ID, connected: false, state: 'not-installed', primary };
    try {
      const launch = toLaunch(path);
      const ver = await runProcess(launch, ['--version'], { env: this.env(), timeoutMs: 10_000 });
      if (ver.code !== 0) return { id: ID, connected: false, state: 'error', primary };
      const auth = await runProcess(launch, ['auth', 'status', '--json'], { env: this.env(), timeoutMs: 10_000 });
      const info = (tryParseJson(auth.stdout) ?? {}) as {
        loggedIn?: boolean;
        email?: string;
        subscriptionType?: string;
      };
      if (info.loggedIn === false) return { id: ID, connected: false, state: 'needs-login', primary };
      const st: ProviderStatus = {
        id: ID,
        connected: true,
        state: 'ok',
        primary,
        account: info.email ?? `Claude Code ${ver.stdout.trim()}`,
      };
      if (info.subscriptionType) st.plan = info.subscriptionType;
      return st;
    } catch (err) {
      this.deps.logger.warn('claude: status check failed', { error: err instanceof Error ? err.message : String(err) });
      return { id: ID, connected: false, state: 'error', primary };
    }
  }

  async complete(req: BrainRequest): Promise<BrainResponse> {
    const path = this.cliPath();
    if (!path) throw new ProviderError('Claude Code CLI not found', 'not-configured', ID);
    const tmp = await privateTempDir('jarvis-claude-');
    try {
      const args = [
        '-p',
        '--output-format',
        'json',
        '--model',
        req.tier === 'smart' ? 'sonnet' : 'haiku',
        '--tools',
        '',
        '--strict-mcp-config',
        '--mcp-config',
        '{"mcpServers":{}}',
        '--setting-sources',
        '',
        '--no-session-persistence',
      ];
      const sys = systemText(req.messages);
      if (sys) args.push('--system-prompt-file', await tmp.write('system.txt', sys));
      if (req.jsonSchema) args.push('--json-schema', JSON.stringify(req.jsonSchema));

      const res = await runProcess(toLaunch(path), args, {
        stdin: transcript(req.messages),
        env: this.env(),
        cwd: tmp.dir,
        timeoutMs: TIMEOUT_MS,
        signal: req.signal,
      });
      const env = tryParseJson(res.stdout) as ClaudeEnvelope | undefined;
      if (!env || typeof env !== 'object') {
        const detail = tail(res.stderr || res.stdout);
        throw new ProviderError(
          `Claude CLI failed (exit ${res.code}): ${detail}`,
          res.code === 0 ? 'bad-response' : classifyCliFailure(detail),
          ID,
        );
      }
      if (env.is_error || res.code !== 0) {
        const detail = env.result ?? tail(res.stderr);
        const code =
          env.api_error_status === 429
            ? 'cap-reached'
            : env.api_error_status === 401
              ? 'needs-login'
              : classifyCliFailure(detail);
        throw new ProviderError(`Claude CLI error: ${detail}`, code, ID);
      }
      const text = typeof env.result === 'string' ? env.result : '';
      const out: BrainResponse = {
        text: text || (env.structured_output !== undefined ? JSON.stringify(env.structured_output) : ''),
      };
      if (req.jsonSchema) {
        const json = env.structured_output ?? tryParseJson(text);
        if (json !== undefined) out.json = json;
      }
      if (env.usage) out.usage = { inputTokens: env.usage.input_tokens, outputTokens: env.usage.output_tokens };
      // Not streamed: deliver the whole reply as one delta (plain-text requests only).
      if (out.text && !req.jsonSchema) req.onDelta?.(out.text);
      return out;
    } catch (err) {
      throw mapProcessError(err, ID);
    } finally {
      await tmp.cleanup();
    }
  }
}
