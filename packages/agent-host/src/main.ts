/**
 * Sidecar entry point (Bun-compiled binary in production, Bun/Node in dev).
 *
 * Env:
 *   JARVIS_LAUNCH_TOKEN   required — random token from the Rust shell (read once, then removed from env)
 *   JARVIS_DATA_DIR       optional — overrides the OS data dir
 *   JARVIS_DEV_SECRETS    'memory' → in-memory secrets (tests, headless dev)
 *   JARVIS_MCP_COMMAND    optional — path of the `jarvis-mcp` bridge attached to Claude sessions
 *   JARVIS_NO_WATCHDOG    '1' → do not exit when no shell is connected (headless dev)
 *   JARVIS_LOG_LEVEL      debug|info|warn|error (default info)
 */
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DATA_FILES, LAUNCH_TOKEN_ENV, type OsName, READY_PREFIX, dataDir as resolveDataDir } from '@jarvis/core';
import { App, VERSION } from './app.js';
import { removeConnectionFile, writeConnectionFile } from './connection-file.js';
import { loadProviders } from './load-providers.js';
import { FileLogger, type Level } from './log/logger.js';
import { OsProcessInspector } from './process/proc.js';
import { emptyBrainRegistry, emptySttRegistry, emptyTtsRegistry, type ProviderDeps } from './providers-contract.js';
import { RpcServer } from './rpc/server.js';
import { createSecretStore } from './secrets.js';
import { openDatabase } from './store/sqlite.js';
import { Store } from './store/store.js';
import { randomToken } from './util.js';

async function main(): Promise<void> {
  // Read the launch token once and remove it so no child process can ever inherit it.
  const launchToken = process.env[LAUNCH_TOKEN_ENV] ?? '';
  delete process.env[LAUNCH_TOKEN_ENV];
  if (launchToken.length < 32) {
    process.stderr.write(`${LAUNCH_TOKEN_ENV} missing or too short\n`);
    process.exit(2);
  }

  const dir = resolveDataDir(process.platform as OsName, process.env, homedir());
  mkdirSync(join(dir, 'logs', 'sessions'), { recursive: true, mode: 0o700 });
  const logger = new FileLogger({
    file: join(dir, DATA_FILES.appLog),
    level: (process.env.JARVIS_LOG_LEVEL as Level) || 'info',
    stderr: process.env.JARVIS_LOG_STDERR === '1',
  });
  logger.info('agent-host starting', {
    version: VERSION,
    pid: process.pid,
    runtime: process.versions.bun ? 'bun' : 'node',
  });

  const store = new Store(await openDatabase(join(dir, DATA_FILES.db)));
  const mcpToken = randomToken(32);
  let app: App | null = null;

  const shutdown = async (code: number) => {
    logger.info('agent-host shutting down', { code });
    try {
      app?.stop();
      await removeConnectionFile(dir);
      await server.close();
      store.close();
      await logger.flush();
    } finally {
      process.exit(code);
    }
  };

  const server = new RpcServer({
    launchToken,
    mcpToken,
    resolveSessionToken: (token) => app?.tokens.resolve(token),
    logger,
    shellGraceMs: 10_000,
    onShellLost:
      process.env.JARVIS_NO_WATCHDOG === '1'
        ? undefined
        : () => {
            logger.warn('shell disconnected for more than 10 s, exiting');
            void shutdown(0);
          },
  });
  const secrets = createSecretStore(process.env, server, logger);

  const mod = await loadProviders(logger);
  const providerDeps: ProviderDeps = {
    secrets,
    settings: () => store.getSettings(),
    logger,
    openUrl: async (url) => {
      await server.call('host.open', { target: url, kind: 'url' });
    },
    dataDir: dir,
  };
  const mcpPath = process.env.JARVIS_MCP_COMMAND;
  app = new App({
    store,
    host: server,
    ui: server,
    logger,
    secrets,
    dataDir: dir,
    brains: mod ? mod.createBrainRegistry(providerDeps) : emptyBrainRegistry(),
    tts: mod ? mod.createTtsRegistry(providerDeps) : emptyTtsRegistry(),
    stt: mod ? mod.createSttRegistry(providerDeps) : emptySttRegistry(),
    chatgptAuth: mod ? new mod.ChatGptPlanAuth(providerDeps) : undefined,
    inspector: new OsProcessInspector(),
    // The bridge gets exactly what it needs: the port here, the per-session token from the driver.
    mcpCommand: () => (mcpPath ? { command: mcpPath, args: [], env: { JARVIS_MCP_PORT: String(server.port) } } : null),
  });
  app.register(server);

  const port = await server.listen();
  await writeConnectionFile(dir, { port, mcpToken, pid: process.pid, version: VERSION, startedAt: Date.now() });
  await app.start();
  process.stdout.write(`${READY_PREFIX} ${port}\n`);
  logger.info('agent-host ready', { port });

  // Watchdog also covers "the shell never connected" (e.g. it crashed during startup).
  if (process.env.JARVIS_NO_WATCHDOG !== '1') {
    setTimeout(() => {
      if (!server.connected && server.clientCount('shell') === 0) {
        logger.warn('no shell connected within 30 s, exiting');
        void shutdown(0);
      }
    }, 30_000).unref();
  }

  process.on('SIGINT', () => void shutdown(0));
  process.on('SIGTERM', () => void shutdown(0));
  process.on('uncaughtException', (e) => logger.error('uncaught exception', { error: e }));
  process.on('unhandledRejection', (e) => logger.error('unhandled rejection', { error: e }));
}

void main();
