import type { TtsId, TtsProvider } from '@jarvis/core';
import type { ProviderDeps } from '../deps.js';
import { ElevenLabsTts } from './elevenlabs.js';
import { FishTts } from './fish.js';
import { KokoroTts } from './kokoro.js';
import { OpenAiTts } from './openai.js';
import { PiperTts } from './piper.js';

export interface TtsRegistry {
  get(id: TtsId): TtsProvider | undefined;
  list(): TtsProvider[];
}

/** Cloud and local TTS providers. `system` is implemented by the host (OS speech APIs), not here. */
export function createTtsRegistry(deps: ProviderDeps): TtsRegistry {
  const providers: TtsProvider[] = [
    new ElevenLabsTts(deps),
    new FishTts(deps),
    new OpenAiTts(deps),
    new PiperTts(deps),
    new KokoroTts(deps),
  ];
  const byId = new Map(providers.map((p) => [p.id, p]));
  return { get: (id) => byId.get(id), list: () => [...providers] };
}
