/**
 * `chatgpt` brain — spends the user's ChatGPT plan allowance through Sign in with ChatGPT tokens.
 * Only POST /v1/responses with store:false + stream:true. Never falls back to a paid API key (R10).
 */
import {
  type BrainProvider,
  type BrainRequest,
  type BrainResponse,
  ProviderError,
  type ProviderStatus,
} from '@jarvis/core';
import type { ChatGptPlanAuth } from '../auth/chatgpt-auth.js';
import { fetchOf, type ProviderDeps } from '../deps.js';
import { fetchRetry, operation } from '../util/http.js';
import { jsonInstruction } from '../util/json.js';
import { isStructuredOutputRejection, OPENAI_API_BASE, ResponsesHttpError, streamResponses } from './responses.js';

const ID = 'chatgpt';
const TIMEOUT_MS = 45_000;
/** How long the UI keeps showing "cap reached" after a 429 usage-limit error without a retry-after. */
const CAP_COOLDOWN_MS = 15 * 60_000;

export interface ChatGptModel {
  slug: string;
  displayName: string;
}

export interface ChatGptBrainOptions {
  apiBase?: string;
  now?: () => number;
}

export class ChatGptBrain implements BrainProvider {
  readonly id = ID;
  readonly label = 'ChatGPT (your plan)';
  readonly vision = true;
  private readonly apiBase: string;
  private readonly now: () => number;
  private models: ChatGptModel[] | undefined;
  private modelsFor: string | undefined;
  /** null = unknown, false = server rejected text.format for this account. */
  private structuredSupported: boolean | null = null;
  private capReachedUntil = 0;

  constructor(
    private readonly deps: ProviderDeps,
    readonly auth: ChatGptPlanAuth,
    options: ChatGptBrainOptions = {},
  ) {
    this.apiBase = (options.apiBase ?? OPENAI_API_BASE).replace(/\/$/, '');
    this.now = options.now ?? Date.now;
  }

  async status(): Promise<ProviderStatus> {
    const primary = this.deps.settings().primaryBrain === ID;
    const acct = await this.auth.account();
    if (!acct || !(await this.auth.isSignedIn())) return { id: ID, connected: false, state: 'needs-login', primary };
    const base: ProviderStatus = { id: ID, connected: true, account: acct.account, state: 'ok', primary };
    if (acct.plan) base.plan = acct.plan;
    if (this.capReachedUntil > this.now()) base.state = 'cap-reached';
    return base;
  }

  /** Models available to the signed-in account (`visibility: "list"`), in server order. */
  async listModels(signal?: AbortSignal): Promise<ChatGptModel[]> {
    const acct = (await this.auth.account())?.account;
    if (this.models && this.modelsFor === acct) return this.models;
    const token = await this.auth.getAccessToken();
    const res = await fetchRetry(
      fetchOf(this.deps),
      `${this.apiBase}/models`,
      { headers: { authorization: `Bearer ${token}` }, signal: signal ?? AbortSignal.timeout(15_000) },
      ID,
    );
    if (res.status === 401) throw new ProviderError('ChatGPT session expired — sign in again', 'needs-login', ID);
    if (!res.ok) throw new ProviderError(`Model list failed: HTTP ${res.status}`, 'bad-response', ID);
    const body = (await res.json()) as {
      models?: Array<{ slug?: string; display_name?: string; visibility?: string }>;
      data?: Array<{ id?: string }>;
    };
    const list: ChatGptModel[] = [];
    for (const m of body.models ?? []) {
      if (m.slug && (m.visibility === undefined || m.visibility === 'list')) {
        list.push({ slug: m.slug, displayName: m.display_name ?? m.slug });
      }
    }
    if (list.length === 0) for (const m of body.data ?? []) if (m.id) list.push({ slug: m.id, displayName: m.id });
    this.models = list;
    this.modelsFor = acct;
    return list;
  }

  private async pickModel(req: BrainRequest, signal: AbortSignal): Promise<string> {
    const configured = this.deps.settings().chatgptModel;
    if (configured) return configured;
    const models = await this.listModels(signal);
    if (models.length === 0)
      throw new ProviderError('No ChatGPT models are available for this account', 'bad-response', ID);
    // Server order is preserved; for fast routing prefer a small model when the account offers one.
    if (req.tier !== 'smart') {
      const small = models.find((m) => /mini|nano|fast|instant/i.test(m.slug));
      if (small) return small.slug;
    }
    return (models[0] as ChatGptModel).slug;
  }

  async complete(req: BrainRequest): Promise<BrainResponse> {
    const op = operation(ID, TIMEOUT_MS, req.signal);
    try {
      const model = await this.pickModel(req, op.signal);
      const run = async (structured: boolean, token: string): Promise<BrainResponse> => {
        const effective =
          !structured && req.jsonSchema
            ? {
                ...req,
                messages: [...req.messages, { role: 'system' as const, content: jsonInstruction(req.jsonSchema) }],
              }
            : req;
        return streamResponses({
          fetch: fetchOf(this.deps),
          url: `${this.apiBase}/responses`,
          headers: { authorization: `Bearer ${token}` },
          model,
          req: effective,
          structured,
          provider: ID,
          signal: op.signal,
        });
      };
      const wantStructured = !!req.jsonSchema && this.structuredSupported !== false;
      let token = await this.auth.getAccessToken();
      let out: BrainResponse;
      try {
        try {
          out = await run(wantStructured, token);
        } catch (e) {
          // Access token rejected although it looked valid: refresh once, then retry.
          if (e instanceof ResponsesHttpError && e.body.status === 401 && !e.inStream) {
            token = await this.auth.forceRefresh();
            out = await run(wantStructured, token);
          } else throw e;
        }
        if (wantStructured) this.structuredSupported = true;
      } catch (e) {
        if (wantStructured && e instanceof ResponsesHttpError && isStructuredOutputRejection(e)) {
          this.deps.logger.info('chatgpt: structured output rejected; falling back to JSON-in-text');
          this.structuredSupported = false;
          out = await run(false, token);
        } else throw e;
      }
      op.done();
      return out;
    } catch (e) {
      throw this.mapError(e, op.fail.bind(op));
    }
  }

  private mapError(e: unknown, fallback: (e: unknown) => ProviderError): ProviderError {
    if (!(e instanceof ResponsesHttpError)) return fallback(e);
    const { code, status, message, retryAfterMs } = e.body;
    switch (code) {
      case 'subscription_sharing_usage_limit_exceeded':
        this.capReachedUntil = this.now() + (retryAfterMs ?? CAP_COOLDOWN_MS);
        return new ProviderError(
          'ChatGPT plan usage limit reached. Review your plan or this app’s limit in ChatGPT settings.',
          'cap-reached',
          ID,
          retryAfterMs,
        );
      case 'subscription_sharing_invalid_user':
        return new ProviderError('ChatGPT access was revoked — sign in again', 'needs-login', ID);
      case 'subscription_sharing_user_not_eligible':
        return new ProviderError('This ChatGPT account is not eligible to use its plan in apps', 'not-configured', ID);
      case 'subscription_sharing_usage_unavailable':
      case 'subscription_sharing_user_unavailable':
        return new ProviderError(
          'ChatGPT plan usage is temporarily unavailable',
          'rate-limited',
          ID,
          retryAfterMs ?? 30_000,
        );
    }
    if (status === 401) return new ProviderError('ChatGPT session expired — sign in again', 'needs-login', ID);
    if (status === 429) return new ProviderError(`ChatGPT rate limited: ${message}`, 'rate-limited', ID, retryAfterMs);
    if (status === 503)
      return new ProviderError('ChatGPT is temporarily unavailable', 'rate-limited', ID, retryAfterMs ?? 30_000);
    if (status >= 500) return new ProviderError(`ChatGPT server error: ${message}`, 'network', ID, retryAfterMs);
    return new ProviderError(`ChatGPT request failed${code ? ` (${code})` : ''}: ${message}`, 'bad-response', ID);
  }
}
