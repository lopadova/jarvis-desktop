/**
 * `run/agent-host.json` lets local MCP bridges find the sidecar. It carries `mcpToken`, which only
 * authorises the `mcp` role (`mcp.call`). Written with mode 0600 on Unix (owner-only).
 * Windows: POSIX modes are ignored; the file inherits the ACL of the per-user app-data folder
 * (%APPDATA%\Jarvis, readable by the user, SYSTEM and Administrators). Tightening it with an explicit
 * ACL is a follow-up for the Rust shell.
 */
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type ConnectionFile, DATA_FILES } from '@jarvis/core';

export const connectionPath = (dataDir: string): string => join(dataDir, DATA_FILES.connection);

export async function writeConnectionFile(dataDir: string, info: ConnectionFile): Promise<string> {
  const file = connectionPath(dataDir);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify(info), { mode: 0o600 });
  if (process.platform !== 'win32') await chmod(file, 0o600);
  return file;
}

export async function removeConnectionFile(dataDir: string): Promise<void> {
  await rm(connectionPath(dataDir), { force: true });
}
