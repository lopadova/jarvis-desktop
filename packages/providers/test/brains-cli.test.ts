import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeCliBrain } from '../src/brains/claude-cli.js';
import { CodexCliBrain, parseCodexJsonl } from '../src/brains/codex-cli.js';
import { findCli, sanitizedEnv, toLaunch } from '../src/util/process.js';
import { makeDeps } from './helpers.js';

const FAKE = fileURLToPath(new URL('./fixtures/fake-cli.mjs', import.meta.url));
const SECRET_PROMPT = 'please summarise my private notes about project Zephyr';
const schema = {
  type: 'object',
  additionalProperties: false,
  properties: { speak: { type: 'string' } },
  required: ['speak'],
};

interface Report {
  argv: string[];
  stdin: string;
  cwd: string;
  env: Record<string, string | null>;
  systemPromptFile: string | null;
  systemPrompt: string | null;
  schemaFile: string | null;
  schema: string | null;
}

let dir: string;
let report: string;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-cli-test-'));
  report = join(dir, 'report.json');
  for (const k of [
    'FAKE_REPORT',
    'FAKE_MODE',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'CODEX_API_KEY',
    'JARVIS_LAUNCH_TOKEN',
  ])
    saved[k] = process.env[k];
  process.env.FAKE_REPORT = report;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-should-be-stripped';
  process.env.OPENAI_API_KEY = 'sk-openai-should-be-stripped';
  process.env.CODEX_API_KEY = 'sk-codex-should-be-stripped';
  process.env.JARVIS_LAUNCH_TOKEN = 'launch-token';
  delete process.env.FAKE_MODE;
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const readReport = () => JSON.parse(readFileSync(report, 'utf8')) as Report;

describe('claude CLI brain', () => {
  const brain = () => new ClaudeCliBrain(makeDeps({ patch: { claudePath: FAKE } }).deps);

  it('passes the prompt on stdin (not argv), the system prompt via a temp file, and strips the API key', async () => {
    const out = await brain().complete({
      messages: [
        { role: 'system', content: 'You are Jarvis. Reply in JSON.' },
        { role: 'user', content: SECRET_PROMPT },
      ],
      jsonSchema: schema,
    });
    expect(out.json).toEqual({ speak: 'from claude' });
    expect(out.usage).toEqual({ inputTokens: 11, outputTokens: 4 });
    const r = readReport();
    expect(r.stdin).toBe(SECRET_PROMPT);
    expect(r.argv.join(' ')).not.toContain('Zephyr');
    expect(r.argv.join(' ')).not.toContain('You are Jarvis');
    expect(r.systemPrompt).toBe('You are Jarvis. Reply in JSON.');
    expect(existsSync(r.systemPromptFile as string)).toBe(false); // deleted afterwards
    expect(r.env.ANTHROPIC_API_KEY).toBeNull();
    expect(r.env.JARVIS_LAUNCH_TOKEN).toBeNull();
    expect(r.env.MAX_THINKING_TOKENS).toBe('0');
    expect(r.argv.slice(0, 5)).toEqual(['-p', '--output-format', 'json', '--model', 'haiku']);
    expect(r.argv).toEqual(
      expect.arrayContaining([
        '--tools',
        '',
        '--strict-mcp-config',
        '--mcp-config',
        '{"mcpServers":{}}',
        '--setting-sources',
      ]),
    );
    expect(JSON.parse(r.argv[r.argv.indexOf('--json-schema') + 1] as string)).toEqual(schema);
  });

  it('returns plain text and emits it as a delta when no schema is requested', async () => {
    const deltas: string[] = [];
    const out = await brain().complete({ messages: [{ role: 'user', content: 'hi' }], onDelta: (d) => deltas.push(d) });
    expect(out.text).toBe('plain reply');
    expect(out.json).toBeUndefined();
    expect(deltas).toEqual(['plain reply']);
    expect(readReport().argv).not.toContain('--json-schema');
  });

  it('maps a subscription limit to cap-reached', async () => {
    process.env.FAKE_MODE = 'limit';
    await expect(brain().complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({
      code: 'cap-reached',
    });
  });

  it('honours abort', async () => {
    process.env.FAKE_MODE = 'hang';
    const ac = new AbortController();
    const p = brain().complete({ messages: [{ role: 'user', content: 'x' }], signal: ac.signal });
    setTimeout(() => ac.abort(), 300);
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
  });

  it('reports version, account and plan in status()', async () => {
    const st = await brain().status();
    expect(st).toMatchObject({ id: 'claude', connected: true, state: 'ok', account: 'me@example.com', plan: 'max' });
    process.env.FAKE_MODE = 'logged-out';
    expect((await brain().status()).state).toBe('needs-login');
  });

  it('reports not-installed / not-configured when the CLI is missing', async () => {
    const b = new ClaudeCliBrain(makeDeps({ patch: { claudePath: join(dir, 'missing') } }).deps);
    expect((await b.status()).state).toBe('not-installed');
    await expect(b.complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({
      code: 'not-configured',
    });
  });
});

describe('codex CLI brain', () => {
  const brain = () => new CodexCliBrain(makeDeps({ patch: { codexPath: FAKE } }).deps);

  it('runs codex exec with the prompt on stdin, a schema file, and no API keys in env', async () => {
    const out = await brain().complete({
      messages: [
        { role: 'system', content: 'You are Jarvis.' },
        { role: 'user', content: SECRET_PROMPT },
      ],
      jsonSchema: schema,
    });
    expect(out.json).toEqual({ speak: 'from codex' });
    expect(out.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
    const r = readReport();
    expect(r.argv[0]).toBe('exec');
    expect(r.argv).toEqual(expect.arrayContaining(['--json', '--skip-git-repo-check', '--sandbox', 'read-only']));
    expect(r.argv[r.argv.length - 1]).toBe('-');
    expect(JSON.parse(r.schema as string)).toEqual(schema);
    expect(r.stdin).toContain(SECRET_PROMPT);
    expect(r.stdin).toContain('You are Jarvis.');
    expect(r.argv.join(' ')).not.toContain('Zephyr');
    expect(r.env.OPENAI_API_KEY).toBeNull();
    expect(r.env.CODEX_API_KEY).toBeNull();
    expect(existsSync(r.schemaFile as string)).toBe(false);
  });

  it('maps a usage-limit turn failure to cap-reached', async () => {
    process.env.FAKE_MODE = 'limit';
    await expect(brain().complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({
      code: 'cap-reached',
    });
  });

  it('status reflects login state', async () => {
    expect(await brain().status()).toMatchObject({ state: 'ok', plan: 'ChatGPT' });
    process.env.FAKE_MODE = 'logged-out';
    expect((await brain().status()).state).toBe('needs-login');
  });

  it('parses JSONL and keeps the last agent message', () => {
    const out = parseCodexJsonl(
      [
        '{"type":"item.completed","item":{"type":"agent_message","text":"first"}}',
        'garbage',
        '{"type":"item.completed","item":{"type":"agent_message","text":"final"}}',
      ].join('\n'),
    );
    expect(out.text).toBe('final');
  });
});

describe('CLI discovery helpers', () => {
  it.skipIf(process.platform !== 'win32')('resolves npm .cmd shims to their JS entry point without a shell', () => {
    const shimDir = mkdtempSync(join(tmpdir(), 'jarvis-shim-'));
    const script = join(shimDir, 'node_modules', '@openai', 'codex', 'bin');
    mkdirSync(script, { recursive: true });
    writeFileSync(join(script, 'codex.js'), '');
    const cmd = join(shimDir, 'codex.cmd');
    writeFileSync(cmd, '@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n');
    const launch = toLaunch(cmd);
    expect(launch.prefixArgs).toEqual([join(script, 'codex.js')]);
    expect(launch.command).toBe(process.execPath);
  });

  it('finds an explicitly configured path and returns null when missing', () => {
    expect(findCli('claude', FAKE)).toBe(FAKE);
    expect(findCli('claude', join(dir, 'nope'))).toBeNull();
  });

  it('finds CLIs on PATH', () => {
    const bin = mkdtempSync(join(tmpdir(), 'jarvis-path-'));
    const name = process.platform === 'win32' ? 'mycli.exe' : 'mycli';
    writeFileSync(join(bin, name), '');
    expect(findCli('mycli', '', { env: { PATH: bin, PATHEXT: '.EXE;.CMD' }, home: dir })).toBe(join(bin, name));
  });

  it('strips variables case-insensitively', () => {
    const env = sanitizedEnv(['OPENAI_API_KEY'], {
      openai_api_key: 'x',
      OPENAI_API_KEY: 'y',
      KEEP: '1',
      JARVIS_LAUNCH_TOKEN: 't',
    });
    expect(env).toEqual({ KEEP: '1' });
  });
});
