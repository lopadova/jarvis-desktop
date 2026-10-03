import { ProviderError, SECRET_KEYS } from '@jarvis/core';
import { describe, expect, it } from 'vitest';
import type { ChatGptPlanAuth } from '../src/auth/chatgpt-auth.js';
import { AnthropicApiBrain } from '../src/brains/api-anthropic.js';
import { OpenAiApiBrain } from '../src/brains/api-openai.js';
import { ChatGptBrain } from '../src/brains/chatgpt.js';
import { LocalBrain } from '../src/brains/local.js';
import { createBrainRegistry } from '../src/brains/registry.js';
import { parseSse } from '../src/util/sse.js';
import { json, makeDeps, mockFetch, type RecordedCall, sse } from './helpers.js';

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: { speak: { type: 'string' } },
  required: ['speak'],
};

const fakeAuth = (over: Partial<Record<keyof ChatGptPlanAuth, unknown>> = {}) =>
  ({
    getAccessToken: async () => 'plan-access-token',
    forceRefresh: async () => 'plan-access-token-2',
    isSignedIn: async () => true,
    account: async () => ({ account: 'user@example.com', plan: 'plus' }),
    ...over,
  }) as unknown as ChatGptPlanAuth;

const completed = (usage = { input_tokens: 10, output_tokens: 5 }) => ({
  type: 'response.completed',
  response: { status: 'completed', usage },
});

const bodyOf = (c: RecordedCall | undefined) => JSON.parse(c?.body as string) as Record<string, unknown>;

describe('SSE parser', () => {
  it('handles CRLF, multi-line data, comments and chunk splits', async () => {
    const raw = ': keep-alive\r\nevent: a\r\ndata: {"x":1,\r\ndata: "y":2}\r\n\r\ndata: [DONE]\n\n';
    const bytes = new TextEncoder().encode(raw);
    async function* chunks() {
      for (let i = 0; i < bytes.length; i += 3) yield bytes.slice(i, i + 3);
    }
    const out = [];
    for await (const e of parseSse(chunks())) out.push(e);
    expect(out).toEqual([{ event: 'a', data: '{"x":1,\n"y":2}' }, { data: '[DONE]' }]);
  });
});

describe('chatgpt brain (plan tokens)', () => {
  const setup = (routes: Parameters<typeof mockFetch>[0], patch = {}) => {
    const m = mockFetch(routes);
    const { deps, secrets } = makeDeps({ fetch: m.fetch, patch });
    secrets.map.set(SECRET_KEYS.openaiApiKey, 'sk-paid-key-must-not-be-used');
    return { ...m, brain: new ChatGptBrain(deps, fakeAuth()), secrets };
  };

  it('streams Responses API deltas and succeeds only after response.completed', async () => {
    const { brain, calls } = setup(
      [
        [
          'POST https://api.openai.com/v1/responses',
          () =>
            sse([
              { type: 'response.created' },
              { type: 'response.output_text.delta', delta: '{"speak":' },
              { type: 'response.output_text.delta', delta: '"Ciao!"}' },
              completed(),
            ]),
        ],
      ],
      { chatgptModel: 'gpt-5.5-mini' },
    );
    const deltas: string[] = [];
    const out = await brain.complete({
      messages: [
        { role: 'system', content: 'You are Jarvis.' },
        { role: 'user', content: 'hello' },
      ],
      jsonSchema: schema,
      onDelta: (d) => deltas.push(d),
    });
    expect(out.text).toBe('{"speak":"Ciao!"}');
    expect(out.json).toEqual({ speak: 'Ciao!' });
    expect(out.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(deltas).toEqual(['{"speak":', '"Ciao!"}']);
    const req = calls[0] as RecordedCall;
    expect(req.headers.authorization).toBe('Bearer plan-access-token');
    const body = bodyOf(req);
    expect(body).toMatchObject({ model: 'gpt-5.5-mini', store: false, stream: true });
    expect(body.text).toMatchObject({ format: { type: 'json_schema', schema, strict: true } });
    expect(body.input).toEqual([
      { role: 'developer', content: 'You are Jarvis.' },
      { role: 'user', content: 'hello' },
    ]);
    for (const k of ['temperature', 'max_output_tokens', 'metadata', 'user']) expect(body).not.toHaveProperty(k);
  });

  it('fails when the stream ends without response.completed', async () => {
    const { brain } = setup([['/responses', () => sse([{ type: 'response.output_text.delta', delta: 'partial' }])]], {
      chatgptModel: 'm',
    });
    await expect(brain.complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({
      code: 'bad-response',
    });
  });

  it('picks the model from GET /v1/models (visibility "list", server order)', async () => {
    const { brain, calls } = setup([
      [
        'GET https://api.openai.com/v1/models',
        () =>
          json({
            models: [
              { slug: 'hidden-model', display_name: 'Hidden', visibility: 'hide' },
              { slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list' },
              { slug: 'gpt-5.5-mini', display_name: 'GPT-5.5 mini', visibility: 'list' },
            ],
          }),
      ],
      ['/responses', () => sse([{ type: 'response.output_text.delta', delta: 'ok' }, completed()])],
    ]);
    expect(await brain.listModels()).toEqual([
      { slug: 'gpt-5.5', displayName: 'GPT-5.5' },
      { slug: 'gpt-5.5-mini', displayName: 'GPT-5.5 mini' },
    ]);
    await brain.complete({ messages: [{ role: 'user', content: 'x' }], tier: 'smart' });
    expect(bodyOf(calls.find((c) => c.url.endsWith('/responses'))).model).toBe('gpt-5.5');
    await brain.complete({ messages: [{ role: 'user', content: 'x' }], tier: 'fast' });
    expect(bodyOf(calls.filter((c) => c.url.endsWith('/responses'))[1]).model).toBe('gpt-5.5-mini');
    expect(calls.filter((c) => c.url.endsWith('/models'))).toHaveLength(1); // cached
  });

  it('falls back to JSON-in-text when structured output is rejected, and remembers it', async () => {
    let n = 0;
    const { brain, calls } = setup(
      [
        [
          '/responses',
          () =>
            ++n === 1
              ? json(
                  {
                    error: {
                      code: 'subscription_sharing_unsupported_capability',
                      message: 'text.format is not supported',
                    },
                  },
                  400,
                )
              : sse([{ type: 'response.output_text.delta', delta: 'Sure: {"speak":"hi"}' }, completed()]),
        ],
      ],
      { chatgptModel: 'm' },
    );
    const out = await brain.complete({ messages: [{ role: 'user', content: 'x' }], jsonSchema: schema });
    expect(out.json).toEqual({ speak: 'hi' });
    expect(bodyOf(calls[0])).toHaveProperty('text');
    const fallback = bodyOf(calls[1]);
    expect(fallback).not.toHaveProperty('text');
    expect(JSON.stringify(fallback.input)).toContain('JSON Schema');
    await brain.complete({ messages: [{ role: 'user', content: 'x' }], jsonSchema: schema });
    expect(bodyOf(calls[2])).not.toHaveProperty('text');
  });

  it('maps 429 subscription_sharing_usage_limit_exceeded to cap-reached and never falls back to a paid key', async () => {
    const { brain, calls, secrets } = setup(
      [
        [
          '/responses',
          () =>
            json(
              { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'Usage limit reached' } },
              429,
              { 'retry-after': '120' },
            ),
        ],
      ],
      { chatgptModel: 'm' },
    );
    const err = (await brain
      .complete({ messages: [{ role: 'user', content: 'x' }] })
      .catch((e: unknown) => e)) as ProviderError;
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.code).toBe('cap-reached');
    expect(err.retryAfterMs).toBe(120_000);
    expect(calls).toHaveLength(1);
    for (const c of calls) expect(JSON.stringify(c.headers)).not.toContain('sk-paid-key');
    expect(secrets.reads).not.toContain(SECRET_KEYS.openaiApiKey);
    expect((await brain.status()).state).toBe('cap-reached');
  });

  it('maps a usage-limit error that arrives mid-stream', async () => {
    const { brain } = setup(
      [
        [
          '/responses',
          () =>
            sse([
              { type: 'response.output_text.delta', delta: 'Hel' },
              {
                type: 'response.failed',
                response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'cap' } },
              },
            ]),
        ],
      ],
      { chatgptModel: 'm' },
    );
    await expect(brain.complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({
      code: 'cap-reached',
    });
  });

  it('maps 401 to needs-login after one forced refresh', async () => {
    const { brain, calls } = setup([['/responses', () => json({ error: { message: 'unauthorized' } }, 401)]], {
      chatgptModel: 'm',
    });
    await expect(brain.complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({
      code: 'needs-login',
    });
    expect(calls.map((c) => c.headers.authorization)).toEqual([
      'Bearer plan-access-token',
      'Bearer plan-access-token-2',
    ]);
  });

  it('reports needs-login when not signed in', async () => {
    const { deps } = makeDeps({ patch: { primaryBrain: 'chatgpt' } });
    const brain = new ChatGptBrain(deps, fakeAuth({ account: async () => null, isSignedIn: async () => false }));
    expect(await brain.status()).toEqual({ id: 'chatgpt', connected: false, state: 'needs-login', primary: true });
  });

  it('honours an abort signal', async () => {
    const { brain } = setup([['/responses', () => sse([completed()])]], { chatgptModel: 'm' });
    const ac = new AbortController();
    ac.abort();
    await expect(
      brain.complete({ messages: [{ role: 'user', content: 'x' }], signal: ac.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('api-openai brain', () => {
  it('uses the API key, configured model and json_schema format', async () => {
    const m = mockFetch([
      ['/responses', () => sse([{ type: 'response.output_text.delta', delta: '{"speak":"a"}' }, completed()])],
    ]);
    const { deps, secrets } = makeDeps({ fetch: m.fetch });
    const brain = new OpenAiApiBrain(deps);
    await expect(brain.complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({
      code: 'not-configured',
    });
    secrets.map.set(SECRET_KEYS.openaiApiKey, 'sk-test');
    const out = await brain.complete({ messages: [{ role: 'user', content: 'x' }], jsonSchema: schema });
    expect(out.json).toEqual({ speak: 'a' });
    expect(m.calls[0]?.headers.authorization).toBe('Bearer sk-test');
    expect(bodyOf(m.calls[0])).toMatchObject({
      model: 'gpt-5-mini',
      store: false,
      stream: true,
      text: { format: { type: 'json_schema' } },
    });
  });

  it('retries once on a network error, never on HTTP errors', async () => {
    let n = 0;
    const flaky = (async () => {
      if (++n === 1) throw new TypeError('fetch failed');
      return sse([{ type: 'response.output_text.delta', delta: 'ok' }, completed()]);
    }) as unknown as typeof fetch;
    const { deps, secrets } = makeDeps({ fetch: flaky });
    secrets.map.set(SECRET_KEYS.openaiApiKey, 'sk-test');
    expect((await new OpenAiApiBrain(deps).complete({ messages: [{ role: 'user', content: 'x' }] })).text).toBe('ok');
    expect(n).toBe(2);

    const m = mockFetch([['/responses', () => json({ error: { message: 'slow down' } }, 429, { 'retry-after': '3' })]]);
    const d2 = makeDeps({ fetch: m.fetch });
    d2.secrets.map.set(SECRET_KEYS.openaiApiKey, 'sk-test');
    await expect(
      new OpenAiApiBrain(d2.deps).complete({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({
      code: 'rate-limited',
      retryAfterMs: 3000,
    });
    expect(m.calls).toHaveLength(1);
  });
});

describe('api-anthropic brain', () => {
  it('streams text deltas', async () => {
    const m = mockFetch([
      [
        'POST https://api.anthropic.com/v1/messages',
        () =>
          sse(
            [
              { type: 'message_start', message: { usage: { input_tokens: 12 } } },
              { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
              { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello ' } },
              { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'there' } },
              { type: 'content_block_stop', index: 0 },
              { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
              { type: 'message_stop' },
            ],
            { named: true },
          ),
      ],
    ]);
    const { deps, secrets } = makeDeps({ fetch: m.fetch });
    secrets.map.set(SECRET_KEYS.anthropicApiKey, 'sk-ant-test');
    const deltas: string[] = [];
    const out = await new AnthropicApiBrain(deps).complete({
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'hi' },
      ],
      onDelta: (d) => deltas.push(d),
    });
    expect(out).toEqual({ text: 'Hello there', usage: { inputTokens: 12, outputTokens: 3 } });
    expect(deltas).toEqual(['Hello ', 'there']);
    const c = m.calls[0] as RecordedCall;
    expect(c.headers['x-api-key']).toBe('sk-ant-test');
    expect(c.headers['anthropic-version']).toBe('2023-06-01');
    expect(bodyOf(c)).toMatchObject({
      model: 'claude-haiku-4-5',
      system: 'Be brief.',
      stream: true,
      messages: [{ role: 'user', content: 'hi' }],
    });
  });

  it('gets structured output through a forced tool call', async () => {
    const m = mockFetch([
      [
        '/messages',
        () =>
          sse(
            [
              { type: 'message_start', message: { usage: { input_tokens: 5 } } },
              {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'tool_use', id: 't1', name: 'respond', input: {} },
              },
              { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"speak":' } },
              { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"Done"}' } },
              { type: 'content_block_stop', index: 0 },
              { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 8 } },
              { type: 'message_stop' },
            ],
            { named: true },
          ),
      ],
    ]);
    const { deps, secrets } = makeDeps({ fetch: m.fetch });
    secrets.map.set(SECRET_KEYS.anthropicApiKey, 'k');
    const out = await new AnthropicApiBrain(deps).complete({
      messages: [{ role: 'user', content: 'go' }],
      jsonSchema: schema,
    });
    expect(out.json).toEqual({ speak: 'Done' });
    const body = bodyOf(m.calls[0]);
    expect(body.tools).toEqual([{ name: 'respond', description: expect.any(String), input_schema: schema }]);
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'respond' });
  });

  it('maps overloaded / stream errors', async () => {
    const m = mockFetch([
      ['/messages', () => json({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 529)],
    ]);
    const { deps, secrets } = makeDeps({ fetch: m.fetch });
    secrets.map.set(SECRET_KEYS.anthropicApiKey, 'k');
    await expect(
      new AnthropicApiBrain(deps).complete({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({
      code: 'rate-limited',
    });
  });
});

describe('local brain (OpenAI-compatible)', () => {
  const chunk = (content: string, finish: string | null = null) => ({
    choices: [{ delta: { content }, finish_reason: finish }],
  });

  it('streams chat completions with json_schema and falls back to json_object', async () => {
    let n = 0;
    const m = mockFetch([
      [
        'POST http://127.0.0.1:11434/v1/chat/completions',
        () =>
          ++n === 1
            ? json({ error: { message: 'response_format json_schema unsupported' } }, 400)
            : sse([chunk('{"speak":'), chunk('"ok"}', 'stop'), '[DONE]']),
      ],
    ]);
    const { deps } = makeDeps({ fetch: m.fetch });
    const out = await new LocalBrain(deps).complete({ messages: [{ role: 'user', content: 'x' }], jsonSchema: schema });
    expect(out.json).toEqual({ speak: 'ok' });
    expect(bodyOf(m.calls[0])).toMatchObject({
      model: 'llama3.2',
      stream: true,
      response_format: { type: 'json_schema' },
    });
    expect(bodyOf(m.calls[1])).toMatchObject({ response_format: { type: 'json_object' } });
  });

  it('reports not-installed when the server is unreachable', async () => {
    const down = (async () => {
      throw new TypeError('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const { deps } = makeDeps({ fetch: down });
    expect((await new LocalBrain(deps).status()).state).toBe('not-installed');
  });
});

describe('brain registry', () => {
  it('wires all brains and marks the primary', async () => {
    const m = mockFetch([]);
    const { deps } = makeDeps({
      fetch: m.fetch,
      patch: { primaryBrain: 'api-anthropic', claudePath: '/nope/claude', codexPath: '/nope/codex' },
    });
    const reg = createBrainRegistry(deps);
    expect(reg.list().map((b) => b.id)).toEqual(['chatgpt', 'claude', 'codex', 'api-anthropic', 'api-openai', 'local']);
    expect(reg.get('local')).toBeInstanceOf(LocalBrain);
    const statuses = await reg.statuses();
    expect(statuses.filter((s) => s.primary).map((s) => s.id)).toEqual(['api-anthropic']);
    expect(statuses.find((s) => s.id === 'claude')?.state).toBe('not-installed');
    expect(statuses.find((s) => s.id === 'chatgpt')?.state).toBe('needs-login');
  });
});
