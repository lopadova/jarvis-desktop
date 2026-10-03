import { type BrainRequest, SECRET_KEYS } from '@jarvis/core';
import { describe, expect, it } from 'vitest';
import type { ChatGptPlanAuth } from '../src/auth/chatgpt-auth.js';
import { AnthropicApiBrain } from '../src/brains/api-anthropic.js';
import { OpenAiApiBrain } from '../src/brains/api-openai.js';
import { ChatGptBrain } from '../src/brains/chatgpt.js';
import { ClaudeCliBrain } from '../src/brains/claude-cli.js';
import { CodexCliBrain } from '../src/brains/codex-cli.js';
import { LocalBrain } from '../src/brains/local.js';
import { createBrainRegistry } from '../src/brains/registry.js';
import { json, makeDeps, mockFetch, type RecordedCall, sse } from './helpers.js';

const PNG = 'iVBORw0KGgo='; // a tiny base64 payload is enough: providers pass it through untouched
const req: BrainRequest = {
  messages: [
    { role: 'system', content: 'You are Jarvis.' },
    { role: 'user', content: "what's on my screen?" },
  ],
  images: [{ mime: 'image/png', base64: PNG }],
};
const bodyOf = (c: RecordedCall | undefined) => JSON.parse(c?.body as string) as Record<string, unknown>;
const completed = { type: 'response.completed', response: { status: 'completed' } };

describe('vision (images on the last user message)', () => {
  it('chatgpt plan: Responses input_image data URL', async () => {
    const m = mockFetch([['/responses', () => sse([{ type: 'response.output_text.delta', delta: 'A code editor.' }, completed])]]);
    const { deps } = makeDeps({ fetch: m.fetch, patch: { chatgptModel: 'gpt-5.5' } });
    const auth = {
      getAccessToken: async () => 't',
      forceRefresh: async () => 't2',
      isSignedIn: async () => true,
      account: async () => ({ account: 'a@b.c' }),
    } as unknown as ChatGptPlanAuth;
    const brain = new ChatGptBrain(deps, auth);
    expect(brain.vision).toBe(true);
    expect((await brain.complete(req)).text).toBe('A code editor.');
    const input = bodyOf(m.calls[0]).input as Array<{ role: string; content: unknown }>;
    expect(input[0]).toEqual({ role: 'developer', content: 'You are Jarvis.' });
    expect(input[1]?.content).toEqual([
      { type: 'input_text', text: "what's on my screen?" },
      { type: 'input_image', image_url: `data:image/png;base64,${PNG}`, detail: 'auto' },
    ]);
    expect(bodyOf(m.calls[0]).store).toBe(false);
  });

  it('api-openai: same Responses shape', async () => {
    const m = mockFetch([['/responses', () => sse([{ type: 'response.output_text.delta', delta: 'ok' }, completed])]]);
    const { deps, secrets } = makeDeps({ fetch: m.fetch });
    secrets.map.set(SECRET_KEYS.openaiApiKey, 'sk');
    await new OpenAiApiBrain(deps).complete(req);
    const input = bodyOf(m.calls[0]).input as Array<{ content: unknown }>;
    expect(JSON.stringify(input[1]?.content)).toContain('input_image');
  });

  it('api-anthropic: base64 image block before the text', async () => {
    const m = mockFetch([
      [
        '/messages',
        () =>
          sse(
            [
              { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
              { type: 'message_stop' },
            ],
            { named: true },
          ),
      ],
    ]);
    const { deps, secrets } = makeDeps({ fetch: m.fetch });
    secrets.map.set(SECRET_KEYS.anthropicApiKey, 'k');
    await new AnthropicApiBrain(deps).complete(req);
    expect(bodyOf(m.calls[0]).messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } },
          { type: 'text', text: "what's on my screen?" },
        ],
      },
    ]);
  });

  it('local: image_url parts; a non-vision model fails with a clear ProviderError', async () => {
    const ok = mockFetch([
      [
        '/chat/completions',
        () => sse([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }, '[DONE]']),
      ],
    ]);
    await new LocalBrain(makeDeps({ fetch: ok.fetch }).deps).complete(req);
    const msgs = bodyOf(ok.calls[0]).messages as Array<{ content: unknown }>;
    expect(msgs[1]?.content).toEqual([
      { type: 'text', text: "what's on my screen?" },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } },
    ]);

    const bad = mockFetch([['/chat/completions', () => json({ error: { message: 'model does not support images' } }, 400)]]);
    await expect(new LocalBrain(makeDeps({ fetch: bad.fetch }).deps).complete(req)).rejects.toMatchObject({
      code: 'not-configured',
      message: expect.stringMatching(/cannot read images/),
    });
  });

  it('CLI brains refuse images without spawning anything', async () => {
    const { deps } = makeDeps({ patch: { claudePath: '/nonexistent/claude', codexPath: '/nonexistent/codex' } });
    await expect(new ClaudeCliBrain(deps).complete(req)).rejects.toMatchObject({ code: 'not-configured' });
    await expect(new CodexCliBrain(deps).complete(req)).rejects.toMatchObject({ code: 'not-configured' });
  });

  it('registry: only HTTP brains advertise vision', () => {
    const reg = createBrainRegistry(makeDeps({ fetch: mockFetch([]).fetch }).deps);
    expect(
      reg
        .list()
        .filter((b) => b.vision)
        .map((b) => b.id)
        .sort(),
    ).toEqual(['api-anthropic', 'api-openai', 'chatgpt', 'local']);
  });

  it('requests without images keep plain string content', async () => {
    const m = mockFetch([['/responses', () => sse([{ type: 'response.output_text.delta', delta: 'ok' }, completed])]]);
    const { deps, secrets } = makeDeps({ fetch: m.fetch });
    secrets.map.set(SECRET_KEYS.openaiApiKey, 'sk');
    await new OpenAiApiBrain(deps).complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(bodyOf(m.calls[0]).input).toEqual([{ role: 'user', content: 'hi' }]);
  });
});
