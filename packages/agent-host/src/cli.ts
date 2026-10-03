/**
 * Tiny CLI for E2E tests and headless use:
 *   JARVIS_LAUNCH_TOKEN=… jarvis say "what time is it" [--port 1234] [--wait 5000]
 * Connects as role `ui` (token from env), submits a turn and prints the ui.chat / ui.pill events it
 * receives until --wait ms of silence. The port comes from --port or the connection file.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type ConnectionFile, DATA_FILES, dataDir, LAUNCH_TOKEN_ENV, type OsName } from '@jarvis/core';
import WebSocket from 'ws';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv
    .slice(2)
    .filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
  if (cmd !== 'say' || !rest.length) {
    process.stderr.write('usage: jarvis say "<text>" [--port N] [--wait MS]\n');
    process.exit(64);
  }
  const token = process.env[LAUNCH_TOKEN_ENV];
  if (!token) {
    process.stderr.write(`${LAUNCH_TOKEN_ENV} is not set\n`);
    process.exit(64);
  }
  let port = Number(arg('--port'));
  if (!port) {
    const dir = dataDir(process.platform as OsName, process.env, homedir());
    port = (JSON.parse(readFileSync(join(dir, DATA_FILES.connection), 'utf8')) as ConnectionFile).port;
  }
  const waitMs = Number(arg('--wait') ?? 4000);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?role=ui`, [`jarvis.${token}`]);
  let idle: ReturnType<typeof setTimeout> | null = null;
  const bump = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => {
      ws.close();
      process.exit(0);
    }, waitMs);
  };
  ws.on('open', () => {
    ws.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'turn.submit',
        params: { text: rest.join(' '), source: 'text' },
      }),
    );
    bump();
  });
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString()) as { method?: string; params?: unknown; error?: unknown };
    if (msg.error) process.stdout.write(`error ${JSON.stringify(msg.error)}\n`);
    if (msg.method === 'ui.chat' || msg.method === 'ui.pill' || msg.method === 'ui.sessions') {
      process.stdout.write(`${msg.method} ${JSON.stringify(msg.params)}\n`);
    }
    bump();
  });
  ws.on('error', (e) => {
    process.stderr.write(`connection failed: ${e.message}\n`);
    process.exit(1);
  });
}

void main();
