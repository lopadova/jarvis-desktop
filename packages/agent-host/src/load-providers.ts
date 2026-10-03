/**
 * Loads `@jarvis/providers` at runtime. The literal specifier lets `bun build --compile` bundle it when
 * the package is present; when it is not (standalone builds/tests) the app starts without providers
 * and explains what is missing (graceful degradation, product-spec §6).
 */
import type { Logger } from '@jarvis/core';
import type { ProvidersModule } from './providers-contract.js';
import { errorMessage } from './util.js';

export async function loadProviders(logger: Logger): Promise<ProvidersModule | null> {
  try {
    const mod = (await import('@jarvis/providers')) as unknown as ProvidersModule;
    if (typeof mod.createBrainRegistry !== 'function') throw new Error('unexpected module shape');
    return mod;
  } catch (e) {
    logger.warn('@jarvis/providers not available; brains/TTS/STT disabled', { error: errorMessage(e) });
    return null;
  }
}
