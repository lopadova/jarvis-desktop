/**
 * `local` brain — any OpenAI-compatible Chat Completions endpoint (Ollama by default, LM Studio,
 * llama.cpp server, vLLM…). Uses `response_format: json_schema` and falls back to `json_object`
 * when the server rejects it.
 */
import {
  type BrainProvider,
  type BrainRequest,
  type BrainResponse,
  ProviderError,
  type ProviderStatus,
} from '@jarvis/core';
import { fetchOf, type ProviderDeps } from '../deps.js';
import { bodyChunks, fetchRetry, httpError, operation, readErrorBody } from '../util/http.js';
import { jsonInstruction, tryParseJson } from '../util/json.js';
import { sseJson } from '../util/sse.js';

const ID = 'local';
/** Local models can be slow to load on first use. */
const TIMEOUT_MS = 90_000;

type Format = 'json_schema' | 'json_object';

export class LocalBrain implements BrainProvider {
  readonly id = ID;
  readonly label = 'Local model';
  /** Remembered per base URL once a server rejects json_schema. */
  private readonly formatFor = new Map<string, Format>();

  constructor(private readonly deps: ProviderDeps) {}

  private base(): string {
    return this.deps.settings().localBrain.baseUrl.replace(/\/$/, '');
  }

  async status(): Promise<ProviderStatus> {
    const s = this.deps.settings();
    const primary = s.primaryBrain === ID;
    try {
      const res = await fetchOf(this.deps)(`${this.base()}/models`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return { id: ID, connected: false, state: 'error', primary };
      const body = (await res.json()) as { data?: Array<{ id?: string }> };
      const ids = (body.data ?? []).map((m) => m.id ?? '');
      const has =
        ids.length === 0 || ids.some((id) => id === s.localBrain.model || id.startsWith(`${s.localBrain.model}:`));
      return { id: ID, connected: true, account: s.localBrain.model, state: has ? 'ok' : 'error', primary };
    } catch {
      return { id: ID, connected: false, state: 'not-installed', primary };
    }
  }

  async complete(req: BrainRequest): Promise<BrainResponse> {
    const base = this.base();
    const op = operation(ID, TIMEOUT_MS, req.signal);
    try {
      let format: Format | undefined = req.jsonSchema ? (this.formatFor.get(base) ?? 'json_schema') : undefined;
      for (;;) {
        const res = await fetchRetry(
          fetchOf(this.deps),
          `${base}/chat/completions`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
            body: JSON.stringify(this.body(req, format)),
            signal: op.signal,
          },
          ID,
        );
        if (!res.ok) {
          const err = await readErrorBody(res);
          if (format === 'json_schema' && (res.status === 400 || res.status === 422)) {
            this.deps.logger.info('local: json_schema rejected; retrying with json_object');
            format = 'json_object';
            this.formatFor.set(base, format);
            continue;
          }
          throw httpError(ID, err, { 404: 'not-configured' });
        }
        const out = await this.consume(res, req);
        op.done();
        return out;
      }
    } catch (e) {
      throw op.fail(e);
    }
  }

  private body(req: BrainRequest, format: Format | undefined): Record<string, unknown> {
    const messages = req.messages.map((m) => ({ role: m.role, content: m.content }));
    const body: Record<string, unknown> = { model: this.deps.settings().localBrain.model, messages, stream: true };
    if (req.jsonSchema && format === 'json_schema') {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'jarvis_response',
          schema: req.jsonSchema,
          strict: req.jsonSchema.additionalProperties === false,
        },
      };
    } else if (req.jsonSchema && format === 'json_object') {
      messages.push({ role: 'system', content: jsonInstruction(req.jsonSchema) });
      body.response_format = { type: 'json_object' };
    }
    return body;
  }

  private async consume(res: Response, req: BrainRequest): Promise<BrainResponse> {
    let text = '';
    let finished = false;
    let usage: BrainResponse['usage'];
    for await (const { json } of sseJson(bodyChunks(res))) {
      if (json.error) {
        const e = json.error as { message?: string };
        throw new ProviderError(`Local model error: ${e.message ?? 'unknown'}`, 'bad-response', ID);
      }
      const choice = (
        json.choices as Array<{ delta?: { content?: string }; finish_reason?: string | null }> | undefined
      )?.[0];
      const delta = choice?.delta?.content;
      if (delta) {
        text += delta;
        req.onDelta?.(delta);
      }
      if (choice?.finish_reason) finished = true;
      const u = json.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
      if (u) usage = { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens };
    }
    if (!finished && !text) throw new ProviderError('Local model returned an empty stream', 'bad-response', ID);
    const out: BrainResponse = { text };
    if (usage) out.usage = usage;
    if (req.jsonSchema) {
      const parsed = tryParseJson(text);
      if (parsed !== undefined) out.json = parsed;
    }
    return out;
  }
}
