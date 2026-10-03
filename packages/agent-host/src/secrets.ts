/**
 * Secrets live only in the OS keyring, behind the Rust shell (security-model R6). The sidecar never
 * writes them to SQLite, settings or logs. `JARVIS_DEV_SECRETS=memory` selects an in-memory store for
 * tests and headless development.
 */
import type { Logger, SecretStore } from '@jarvis/core';
import type { HostClient } from './host.js';

export class HostSecretStore implements SecretStore {
  constructor(
    private readonly host: HostClient,
    private readonly logger: Logger,
  ) {}
  async get(key: string): Promise<string | null> {
    const r = await this.host.call('host.secret.get', { key });
    return r.value;
  }
  async set(key: string, value: string): Promise<void> {
    await this.host.call('host.secret.set', { key, value });
    this.logger.info('secret stored', { name: key });
  }
  async delete(key: string): Promise<void> {
    await this.host.call('host.secret.delete', { key });
    this.logger.info('secret deleted', { name: key });
  }
}

export class MemorySecretStore implements SecretStore {
  readonly map = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

export function createSecretStore(env: NodeJS.ProcessEnv, host: HostClient, logger: Logger): SecretStore {
  if (env.JARVIS_DEV_SECRETS === 'memory') {
    logger.warn('using in-memory secrets (JARVIS_DEV_SECRETS=memory)');
    return new MemorySecretStore();
  }
  return new HostSecretStore(host, logger);
}
