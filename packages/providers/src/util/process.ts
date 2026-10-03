/**
 * CLI discovery and safe process execution for the subscription-backed CLIs (Claude Code, Codex).
 * Content (prompts) always travels over stdin, never argv (security-model R6); commands are argument
 * vectors, never shell strings (R8).
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, extname, join, resolve } from 'node:path';
import { LAUNCH_TOKEN_ENV } from '@jarvis/core';

export interface Launch {
  /** Executable actually spawned (the CLI itself, or a JS runtime for script entry points). */
  command: string;
  /** Arguments placed before the CLI arguments (e.g. the script path). */
  prefixArgs: string[];
  /** The path that was discovered (for display). */
  path: string;
}

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Common per-user and system install locations, by OS. */
export function commonInstallDirs(
  platform: NodeJS.Platform = process.platform,
  env = process.env,
  home = homedir(),
): string[] {
  const dirs = [
    join(home, '.claude', 'local'),
    join(home, '.local', 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.bun', 'bin'),
  ];
  if (platform === 'win32') {
    if (env.APPDATA) dirs.push(join(env.APPDATA, 'npm'));
    if (env.LOCALAPPDATA) dirs.push(join(env.LOCALAPPDATA, 'Programs', 'claude'));
  } else {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin');
  }
  return dirs;
}

const windowsExts = (env: NodeJS.ProcessEnv): string[] => {
  const pathext = (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').toLowerCase().split(';').filter(Boolean);
  // Prefer native executables over shims.
  return ['.exe', ...pathext.filter((e) => e !== '.exe' && e !== '.js'), ''];
};

/** Finds a CLI: explicit path from settings, then PATH, then common install dirs. */
export function findCli(
  name: string,
  configured: string,
  opts: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; home?: string } = {},
): string | null {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  if (configured.trim()) {
    const p = resolve(configured.trim().replace(/^~(?=$|[\\/])/, opts.home ?? homedir()));
    return isFile(p) ? p : null;
  }
  const exts = platform === 'win32' ? windowsExts(env) : [''];
  const pathDirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  for (const dir of [...pathDirs, ...commonInstallDirs(platform, env, opts.home)]) {
    for (const ext of exts) {
      const p = join(dir, name + ext);
      if (isFile(p)) return p;
    }
  }
  return null;
}

/** JS runtime used for script entry points: Node when available, otherwise the current runtime. */
function jsRuntime(): string {
  if (!process.versions.bun) return process.execPath;
  return findCli('node', '') ?? process.execPath;
}

/**
 * Turns a discovered path into a spawnable launch without a shell:
 * - `.js/.mjs/.cjs` → run with a JS runtime;
 * - npm `.cmd` shims (Windows) → run the referenced JS entry point directly;
 * - anything else → spawn as-is.
 */
export function toLaunch(path: string): Launch {
  const ext = extname(path).toLowerCase();
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return { command: jsRuntime(), prefixArgs: [path], path };
  if (ext === '.cmd' || ext === '.bat') {
    const src = readFileSync(path, 'utf8');
    const m = /"%~?dp0%?\\([^"]+?\.[cm]?js)"/i.exec(src);
    if (m?.[1]) {
      const script = join(dirname(path), m[1]);
      const localNode = join(dirname(path), 'node.exe');
      if (existsSync(script))
        return { command: existsSync(localNode) ? localNode : jsRuntime(), prefixArgs: [script], path };
    }
    throw new Error(`Cannot launch ${path} without a shell; set the full path to the executable in Settings`);
  }
  return { command: path, prefixArgs: [], path };
}

/** Copy of the current environment without the given variables (case-insensitive on Windows) and our launch token. */
export function sanitizedEnv(remove: readonly string[], base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const drop = new Set([...remove, LAUNCH_TOKEN_ENV].map((k) => k.toUpperCase()));
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) if (!drop.has(k.toUpperCase()) && v !== undefined) out[k] = v;
  return out;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  stdin?: string;
  env: NodeJS.ProcessEnv;
  cwd?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Called with each stdout chunk (e.g. for JSONL streaming). */
  onStdout?: (chunk: string) => void;
}

export class ProcessAbortedError extends Error {
  constructor(readonly reason: 'timeout' | 'aborted') {
    super(reason === 'timeout' ? 'Process timed out' : 'Process cancelled');
    this.name = 'ProcessAbortedError';
  }
}

const MAX_OUTPUT = 8 * 1024 * 1024;

export function runProcess(launch: Launch, args: string[], opts: RunOptions): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    if (opts.signal?.aborted) {
      reject(new ProcessAbortedError('aborted'));
      return;
    }
    const child = spawn(launch.command, [...launch.prefixArgs, ...args], {
      env: opts.env,
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    let killedFor: 'timeout' | 'aborted' | undefined;
    const kill = (why: 'timeout' | 'aborted') => {
      if (killedFor) return;
      killedFor = why;
      child.kill();
      setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 2000).unref();
    };
    const timer = setTimeout(() => kill('timeout'), opts.timeoutMs);
    const onAbort = () => kill('aborted');
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      if (stdout.length < MAX_OUTPUT) stdout += d;
      opts.onStdout?.(d);
    });
    child.stderr.on('data', (d: string) => {
      if (stderr.length < MAX_OUTPUT) stderr += d;
    });
    child.stdin.on('error', () => {}); // EPIPE if the child exits early; reported via exit code
    child.on('error', (err) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      if (killedFor) reject(new ProcessAbortedError(killedFor));
      else resolvePromise({ code, stdout, stderr });
    });
    child.stdin.end(opts.stdin ?? '');
  });
}
