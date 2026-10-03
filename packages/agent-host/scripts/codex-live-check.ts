/**
 * Manual live check of the Codex app-server driver against the installed `codex` CLI (uses the
 * user's Codex plan, a few cents of quota). Not part of CI.
 *   bun run packages/agent-host/scripts/codex-live-check.ts
 * Runs one turn in a temp folder at the `safe` level: shell commands are denied, edits inside the
 * folder are allowed by policy without asking. Prints every event and approval request.
 */
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultSettings } from '@jarvis/core';
import { CodexDriver } from '../src/agents/codex.js';
import { OsProcessInspector } from '../src/process/proc.js';

const cwd = mkdtempSync(join(tmpdir(), 'jarvis-codex-live-'));
const inspector = new OsProcessInspector();
const driver = new CodexDriver({
  settings: defaultSettings,
  logger: {
    debug: (m, d) => console.log('debug', m, JSON.stringify(d ?? {}).slice(0, 300)),
    info: (m, d) => console.log('info', m, JSON.stringify(d ?? {})),
    warn: (m, d) => console.log('warn', m, JSON.stringify(d ?? {})),
    error: (m, d) => console.log('error', m, JSON.stringify(d ?? {})),
  },
  killTree: (pid) => inspector.killTree(pid),
});
console.log('mode:', driver.mode(), 'cwd:', cwd);
const started = Date.now();
for await (const ev of driver.run({
  task: 'First run the shell command `echo hello > shell.txt`. Then create the file note.txt containing "hi". Report in one sentence.',
  cwd,
  guidance: '',
  permission: 'safe',
  allowlist: [],
  signal: new AbortController().signal,
  onProcess: (pid) => console.log('process', pid),
  requestApproval: async (req) => {
    console.log('APPROVAL', req.kind, req.risk, JSON.stringify(req.detail).slice(0, 160), '→ deny');
    return 'deny';
  },
})) {
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s`, JSON.stringify(ev).slice(0, 200));
}
console.log('files:', readdirSync(cwd));
