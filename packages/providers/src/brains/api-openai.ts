/** `api-openai` brain — Responses API with the user's own API key (paid, explicit opt-in). */
import {
  type BrainProvider,
  type BrainRequest,
  type BrainResponse,
  ProviderError,
  type ProviderStatus,
  SECRET_KEYS,
} from '@jarvis/core';
import { fetchOf, type ProviderDeps } from '../deps.js';
import { httpError, operation } from '../util/http.js';
import { OPENAI_API_BASE, ResponsesHttpError, streamResponses } from './responses.js';

const ID = 'api-openai';
const TIMEOUT_MS = 45_000;

export class OpenAiApiBrain implements BrainProvider {
  readonly id = ID;
  readonly label = 'OpenAI API';
  readonly vision = true;

  constructor(
    private readonly deps: ProviderDeps,
    private readonly apiBase = OPENAI_API_BASE,
  ) {}

  async status(): Promise<ProviderStatus> {
    const primary = this.deps.settings().primaryBrain === ID;
    const key = await this.deps.secrets.get(SECRET_KEYS.openaiApiKey);
    return key
      ? { id: ID, connected: true, account: 'API key', state: 'ok', primary }
      : { id: ID, connected: false, state: 'needs-login', primary };
  }

  async complete(req: BrainRequest): Promise<BrainResponse> {
    const key = await this.deps.secrets.get(SECRET_KEYS.openaiApiKey);
    if (!key) throw new ProviderError('No OpenAI API key configured', 'not-configured', ID);
    const op = operation(ID, TIMEOUT_MS, req.signal);
    try {
      const out = await streamResponses({
        fetch: fetchOf(this.deps),
        url: `${this.apiBase}/responses`,
        headers: { authorization: `Bearer ${key}` },
        model: this.deps.settings().apiModels.openai,
        req,
        structured: true,
        provider: ID,
        signal: op.signal,
      });
      op.done();
      return out;
    } catch (e) {
      if (e instanceof ResponsesHttpError) {
        op.done();
        if (e.body.code === 'insufficient_quota') throw new ProviderError(e.message, 'cap-reached', ID);
        throw httpError(ID, e.body);
      }
      throw op.fail(e);
    }
  }
}
