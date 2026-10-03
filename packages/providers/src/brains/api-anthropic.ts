/**
 * `api-anthropic` brain — Messages API with the user's API key. Streams text via SSE; structured
 * output is obtained by forcing a single tool call whose input schema is the requested JSON Schema.
 */
import {
  type BrainMessage,
  type BrainProvider,
  type BrainRequest,
  type BrainResponse,
  ProviderError,
  type ProviderStatus,
  SECRET_KEYS,
} from '@jarvis/core';
import { fetchOf, type ProviderDeps } from '../deps.js';
import { bodyChunks, fetchRetry, httpError, operation, readErrorBody } from '../util/http.js';
import { tryParseJson } from '../util/json.js';
import { sseJson } from '../util/sse.js';

const ID = 'api-anthropic';
const TIMEOUT_MS = 45_000;
export const ANTHROPIC_API_BASE = 'https://api.anthropic.com/v1';
export const ANTHROPIC_VERSION = '2023-06-01';
export const STRUCTURED_TOOL = 'respond';

export function anthropicBody(model: string, req: BrainRequest): Record<string, unknown> {
  const system = req.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of req.messages as BrainMessage[]) {
    if (m.role === 'system') continue;
    const last = messages[messages.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${m.content}`;
    else messages.push({ role: m.role, content: m.content });
  }
  if (messages[0]?.role !== 'user') messages.unshift({ role: 'user', content: '(continue)' });
  const body: Record<string, unknown> = {
    model,
    max_tokens: req.tier === 'smart' ? 4096 : 1024,
    messages,
    stream: true,
  };
  if (system) body.system = system;
  if (req.jsonSchema) {
    body.tools = [
      {
        name: STRUCTURED_TOOL,
        description: 'Return the reply as structured data matching the schema.',
        input_schema: req.jsonSchema,
      },
    ];
    body.tool_choice = { type: 'tool', name: STRUCTURED_TOOL };
  }
  return body;
}

export class AnthropicApiBrain implements BrainProvider {
  readonly id = ID;
  readonly label = 'Anthropic API';

  constructor(
    private readonly deps: ProviderDeps,
    private readonly apiBase = ANTHROPIC_API_BASE,
  ) {}

  async status(): Promise<ProviderStatus> {
    const primary = this.deps.settings().primaryBrain === ID;
    const key = await this.deps.secrets.get(SECRET_KEYS.anthropicApiKey);
    return key
      ? { id: ID, connected: true, account: 'API key', state: 'ok', primary }
      : { id: ID, connected: false, state: 'needs-login', primary };
  }

  async complete(req: BrainRequest): Promise<BrainResponse> {
    const key = await this.deps.secrets.get(SECRET_KEYS.anthropicApiKey);
    if (!key) throw new ProviderError('No Anthropic API key configured', 'not-configured', ID);
    const op = operation(ID, TIMEOUT_MS, req.signal);
    try {
      const res = await fetchRetry(
        fetchOf(this.deps),
        `${this.apiBase}/messages`,
        {
          method: 'POST',
          headers: {
            'x-api-key': key,
            'anthropic-version': ANTHROPIC_VERSION,
            'content-type': 'application/json',
            accept: 'text/event-stream',
          },
          body: JSON.stringify(anthropicBody(this.deps.settings().apiModels.anthropic, req)),
          signal: op.signal,
        },
        ID,
      );
      if (!res.ok) throw httpError(ID, await readErrorBody(res), { 529: 'rate-limited' });

      let text = '';
      let toolJson = '';
      let stopped = false;
      const usage: { inputTokens?: number; outputTokens?: number } = {};
      for await (const { json } of sseJson(bodyChunks(res))) {
        switch (json.type) {
          case 'message_start': {
            const u = (json.message as { usage?: { input_tokens?: number } } | undefined)?.usage;
            if (u?.input_tokens !== undefined) usage.inputTokens = u.input_tokens;
            break;
          }
          case 'content_block_delta': {
            const d = json.delta as { type?: string; text?: string; partial_json?: string } | undefined;
            if (d?.type === 'text_delta' && d.text) {
              text += d.text;
              req.onDelta?.(d.text);
            } else if (d?.type === 'input_json_delta' && d.partial_json) {
              toolJson += d.partial_json;
            }
            break;
          }
          case 'message_delta': {
            const u = json.usage as { output_tokens?: number } | undefined;
            if (u?.output_tokens !== undefined) usage.outputTokens = u.output_tokens;
            break;
          }
          case 'message_stop':
            stopped = true;
            break;
          case 'error': {
            const e = (json.error ?? {}) as { type?: string; message?: string };
            const code =
              e.type === 'overloaded_error' || e.type === 'rate_limit_error' ? 'rate-limited' : 'bad-response';
            throw new ProviderError(`Anthropic stream error: ${e.message ?? e.type ?? 'unknown'}`, code, ID);
          }
        }
        if (stopped) break;
      }
      if (!stopped) throw new ProviderError('Stream ended before message_stop', 'bad-response', ID);
      op.done();
      const out: BrainResponse = { text: toolJson || text };
      if (usage.inputTokens !== undefined || usage.outputTokens !== undefined) out.usage = usage;
      if (req.jsonSchema) {
        const parsed = tryParseJson(toolJson || text);
        if (parsed !== undefined) out.json = parsed;
      }
      return out;
    } catch (e) {
      throw op.fail(e);
    }
  }
}
