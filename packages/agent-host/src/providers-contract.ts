/**
 * Local copy of the factory contract exported by `@jarvis/providers` (built in parallel).
 * The agent-host only depends on these shapes, so it typechecks and is tested standalone with fakes;
 * `load-providers.ts` imports the real module at runtime and casts it to `ProvidersModule`.
 */
import type {
  BrainId,
  BrainProvider,
  Logger,
  ProviderStatus,
  SecretStore,
  Settings,
  SttId,
  SttProvider,
  TtsId,
  TtsProvider,
} from '@jarvis/core';

export interface ProviderDeps {
  secrets: SecretStore;
  settings: () => Settings;
  logger: Logger;
  fetch?: typeof fetch;
  openUrl: (url: string) => Promise<void>;
  dataDir: string;
}

export interface BrainRegistry {
  get(id: BrainId): BrainProvider | undefined;
  list(): BrainProvider[];
  statuses(): Promise<ProviderStatus[]>;
}

/** Cloud and local TTS engines; the OS voice ('system') is implemented by the host via `host.systemSpeak`. */
export interface TtsRegistry {
  get(id: TtsId): TtsProvider | undefined;
  list(): TtsProvider[];
}

/** Cloud STT only; local Whisper runs in the Rust shell. */
export interface SttRegistry {
  get(id: SttId): SttProvider | undefined;
  list(): SttProvider[];
}

export interface ChatGptPlanAuthLike {
  signIn(signal?: AbortSignal): Promise<{ account: string; plan?: string }>;
  signOut(): Promise<void>;
  isSignedIn(): Promise<boolean>;
  getAccessToken(): Promise<string>;
}

export interface ProvidersModule {
  createBrainRegistry(deps: ProviderDeps): BrainRegistry;
  createTtsRegistry(deps: ProviderDeps): TtsRegistry;
  createSttRegistry(deps: ProviderDeps): SttRegistry;
  ChatGptPlanAuth: new (deps: ProviderDeps) => ChatGptPlanAuthLike;
}

/** Providers that never leave the computer (allowed in private mode, security/product requirement). */
export const LOCAL_BRAINS: readonly BrainId[] = ['local'];
export const LOCAL_TTS: readonly TtsId[] = ['kokoro', 'piper', 'system'];
export const LOCAL_STT: readonly SttId[] = ['local-whisper'];

export const emptyBrainRegistry = (): BrainRegistry => ({
  get: () => undefined,
  list: () => [],
  statuses: async () => [],
});
export const emptyTtsRegistry = (): TtsRegistry => ({ get: () => undefined, list: () => [] });
export const emptySttRegistry = (): SttRegistry => ({ get: () => undefined, list: () => [] });
