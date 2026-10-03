import type { Logger, SecretStore, Settings } from '@jarvis/core';

/** Everything a provider needs from its host. All I/O that tests must control is injectable. */
export interface ProviderDeps {
  secrets: SecretStore;
  settings: () => Settings;
  logger: Logger;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Opens the system browser (used by Sign in with ChatGPT). */
  openUrl: (url: string) => Promise<void>;
  /** App data directory; local models live under `<dataDir>/models`. */
  dataDir: string;
}

export const fetchOf = (deps: ProviderDeps): typeof fetch => deps.fetch ?? globalThis.fetch;

/**
 * Resolves the user's preferred voice for a provider. `settings.ttsVoice` keys:
 * `"<provider>.<locale>"` (e.g. `"elevenlabs.it"`) take precedence over `"<provider>"`.
 */
export function preferredVoice(settings: Settings, provider: string, locale: string): string | undefined {
  const lang = locale.slice(0, 2).toLowerCase();
  const v = settings.ttsVoice[`${provider}.${lang}`] ?? settings.ttsVoice[provider];
  return v && v.length > 0 ? v : undefined;
}
