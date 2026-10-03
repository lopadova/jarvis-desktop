/**
 * Redacting file logger (security-model R6). Lines are buffered and appended asynchronously; the file is
 * rotated at `maxBytes` keeping `files` generations (app.log, app.log.1, app.log.2).
 */
import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Logger } from '@jarvis/core';

const PATTERNS: [RegExp, string][] = [
  // Authorization headers and bearer tokens
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [REDACTED]'],
  // JWTs (three base64url segments)
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, '[REDACTED_JWT]'],
  // OpenAI / Anthropic style keys: sk-..., sk-ant-..., sk-proj-...
  [/\bsk-[A-Za-z0-9_-]{8,}/g, '[REDACTED_KEY]'],
  // ElevenLabs / generic 32+ hex keys
  [/\b[a-f0-9]{32,}\b/gi, '[REDACTED_HEX]'],
  // key=value / "key": "value" pairs with sensitive names
  [
    /(["']?(?:api[_-]?key|apikey|token|access[_-]?token|refresh[_-]?token|secret|password|authorization|xi-api-key)["']?\s*[:=]\s*["']?)([^"',\s}]{4,})/gi,
    '$1[REDACTED]',
  ],
];

const SENSITIVE_FIELD = /(key|token|secret|password|authorization|cookie|value)$/i;

/** Redacts secrets from free text. */
export function redact(text: string): string {
  let out = text;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

/** Deep-redacts structured log data: sensitive field names are blanked, strings are pattern-redacted. */
export function redactData(data: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (typeof data === 'string') return redact(data);
  if (Array.isArray(data)) return data.map((d) => redactData(d, depth + 1));
  if (data instanceof Error) return { name: data.name, message: redact(data.message) };
  if (data && typeof data === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      out[k] = SENSITIVE_FIELD.test(k) && typeof v === 'string' ? '[REDACTED]' : redactData(v, depth + 1);
    }
    return out;
  }
  return data;
}

export type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface FileLoggerOptions {
  file: string;
  level?: Level;
  maxBytes?: number;
  files?: number;
  /** Also mirror to stderr (dev). Never stdout: stdout carries the READY line. */
  stderr?: boolean;
  flushIntervalMs?: number;
}

export class FileLogger implements Logger {
  private buf: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();
  private readonly level: number;
  private readonly maxBytes: number;
  private readonly files: number;

  constructor(private readonly opts: FileLoggerOptions) {
    this.level = ORDER[opts.level ?? 'info'];
    this.maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
    this.files = opts.files ?? 3;
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    this.log('debug', msg, data);
  }
  info(msg: string, data?: Record<string, unknown>): void {
    this.log('info', msg, data);
  }
  warn(msg: string, data?: Record<string, unknown>): void {
    this.log('warn', msg, data);
  }
  error(msg: string, data?: Record<string, unknown>): void {
    this.log('error', msg, data);
  }

  log(level: Level, msg: string, data?: Record<string, unknown>): void {
    if (ORDER[level] < this.level) return;
    const line = formatLine(level, msg, data);
    if (this.opts.stderr) process.stderr.write(line);
    this.buf.push(line);
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, this.opts.flushIntervalMs ?? 250);
      this.timer.unref?.();
    }
  }

  /** Writes buffered lines (serialised). */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const chunk = this.buf.join('');
    this.buf = [];
    if (!chunk) return this.writing;
    this.writing = this.writing.then(() => this.write(chunk)).catch(() => undefined);
    return this.writing;
  }

  private async write(chunk: string): Promise<void> {
    const file = this.opts.file;
    await mkdir(dirname(file), { recursive: true });
    const size = await stat(file).then(
      (s) => s.size,
      () => 0,
    );
    if (size + chunk.length > this.maxBytes && size > 0) await this.rotate();
    await appendFile(file, chunk, { mode: 0o600 });
  }

  private async rotate(): Promise<void> {
    const file = this.opts.file;
    await rm(`${file}.${this.files - 1}`, { force: true });
    for (let i = this.files - 2; i >= 1; i--) {
      await rename(`${file}.${i}`, `${file}.${i + 1}`).catch(() => undefined);
    }
    await rename(file, `${file}.1`).catch(() => undefined);
  }
}

export function formatLine(level: Level, msg: string, data?: Record<string, unknown>): string {
  const payload = data ? ` ${JSON.stringify(redactData(data))}` : '';
  return `${new Date().toISOString()} ${level.toUpperCase()} ${redact(msg)}${payload}\n`;
}

/** Collects formatted lines in memory (tests and headless runs). */
export class MemoryLogger implements Logger {
  readonly lines: string[] = [];
  debug(msg: string, data?: Record<string, unknown>): void {
    this.lines.push(formatLine('debug', msg, data));
  }
  info(msg: string, data?: Record<string, unknown>): void {
    this.lines.push(formatLine('info', msg, data));
  }
  warn(msg: string, data?: Record<string, unknown>): void {
    this.lines.push(formatLine('warn', msg, data));
  }
  error(msg: string, data?: Record<string, unknown>): void {
    this.lines.push(formatLine('error', msg, data));
  }
  get text(): string {
    return this.lines.join('');
  }
}
