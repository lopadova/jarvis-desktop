import type { BrainId, BrainProvider, ProviderStatus } from '@jarvis/core';
import { ChatGptPlanAuth } from '../auth/chatgpt-auth.js';
import type { ProviderDeps } from '../deps.js';
import { AnthropicApiBrain } from './api-anthropic.js';
import { OpenAiApiBrain } from './api-openai.js';
import { ChatGptBrain } from './chatgpt.js';
import { ClaudeCliBrain } from './claude-cli.js';
import { CodexCliBrain } from './codex-cli.js';
import { LocalBrain } from './local.js';

export interface BrainRegistry {
  get(id: BrainId): BrainProvider | undefined;
  list(): BrainProvider[];
  statuses(): Promise<ProviderStatus[]>;
}

export interface BrainRegistryOptions {
  /** Share the instance the UI uses for Sign in / Sign out so token state stays consistent. */
  chatgptAuth?: ChatGptPlanAuth;
}

export function createBrainRegistry(deps: ProviderDeps, options: BrainRegistryOptions = {}): BrainRegistry {
  const auth = options.chatgptAuth ?? new ChatGptPlanAuth(deps);
  const brains: BrainProvider[] = [
    new ChatGptBrain(deps, auth),
    new ClaudeCliBrain(deps),
    new CodexCliBrain(deps),
    new AnthropicApiBrain(deps),
    new OpenAiApiBrain(deps),
    new LocalBrain(deps),
  ];
  const byId = new Map(brains.map((b) => [b.id, b]));
  return {
    get: (id) => byId.get(id),
    list: () => [...brains],
    async statuses() {
      const primaryId = deps.settings().primaryBrain;
      return Promise.all(
        brains.map(async (b): Promise<ProviderStatus> => {
          try {
            return { ...(await b.status()), primary: b.id === primaryId };
          } catch (err) {
            deps.logger.warn('brain status failed', {
              id: b.id,
              error: err instanceof Error ? err.message : String(err),
            });
            return { id: b.id, connected: false, state: 'error', primary: b.id === primaryId };
          }
        }),
      );
    },
  };
}
