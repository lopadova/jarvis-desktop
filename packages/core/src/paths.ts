/**
 * Filesystem conventions shared by every process (pure functions, no I/O).
 *
 * Data dir (override with JARVIS_DATA_DIR):
 *   macOS   ~/Library/Application Support/Jarvis
 *   Windows %APPDATA%\Jarvis
 *   Linux   $XDG_DATA_HOME/jarvis  (default ~/.local/share/jarvis)
 *
 * Inside it:
 *   jarvis.db                 SQLite (sessions, memories, turns, reminders, approvals, settings)
 *   logs/app.log              rotated diagnostic log (redacted)
 *   logs/sessions/<id>.ndjson raw agent event log per session
 *   run/agent-host.json       connection file for local MCP bridges (owner-only permissions)
 *   models/                   downloaded local models (whisper, kws, vad, kokoro/piper)
 */

export type OsName = 'darwin' | 'win32' | 'linux';

export function dataDir(os: OsName, env: Record<string, string | undefined>, home: string): string {
  if (env.JARVIS_DATA_DIR) return env.JARVIS_DATA_DIR;
  switch (os) {
    case 'darwin':
      return `${home}/Library/Application Support/Jarvis`;
    case 'win32':
      return `${env.APPDATA ?? `${home}\\AppData\\Roaming`}\\Jarvis`;
    default:
      return `${env.XDG_DATA_HOME ?? `${home}/.local/share`}/jarvis`;
  }
}

export const DATA_FILES = {
  db: 'jarvis.db',
  appLog: 'logs/app.log',
  sessionLogDir: 'logs/sessions',
  connection: 'run/agent-host.json',
  models: 'models',
} as const;

/**
 * Written by the agent-host at startup so local MCP bridges (stdio server launched by Claude Desktop,
 * Claude Code, Codex …) can reach it. `mcpToken` only authorises the `mcp` role (`mcp.call`).
 */
export interface ConnectionFile {
  port: number;
  mcpToken: string;
  pid: number;
  version: string;
  startedAt: number;
}

/** Environment variable carrying the launch token from the Rust shell to the sidecar (never argv). */
export const LAUNCH_TOKEN_ENV = 'JARVIS_LAUNCH_TOKEN';
/** The sidecar prints exactly one line `JARVIS_READY <port>` on stdout once listening. */
export const READY_PREFIX = 'JARVIS_READY';
