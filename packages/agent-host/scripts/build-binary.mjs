#!/usr/bin/env node
/**
 * Builds the sidecar as a single executable with `bun build --compile`, named for Tauri externalBin:
 *   apps/desktop/src-tauri/binaries/agent-host-<rust target triple>[.exe]
 *
 * Target selection (first match wins):
 *   1. env JARVIS_SIDECAR_TARGET=<rust triple> (+ optional BUN_TARGET=<bun target>) — used by release CI
 *   2. CLI arg: node scripts/build-binary.mjs <rust triple>
 *   3. the current host
 * Commands are run as argument vectors (no shell strings).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(here, '..');
const outDir = resolve(pkgDir, '../../apps/desktop/src-tauri/binaries');

const TARGETS = {
  'x86_64-pc-windows-msvc': 'bun-windows-x64',
  'aarch64-apple-darwin': 'bun-darwin-arm64',
  'x86_64-apple-darwin': 'bun-darwin-x64',
  'x86_64-unknown-linux-gnu': 'bun-linux-x64',
  'aarch64-unknown-linux-gnu': 'bun-linux-arm64',
};

function hostTriple() {
  const { platform, arch } = process;
  if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc';
  if (platform === 'darwin') return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  if (platform === 'linux') return arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
  throw new Error(`unsupported host ${platform}/${arch}`);
}

const triple = process.env.JARVIS_SIDECAR_TARGET || process.argv[2] || hostTriple();
const bunTarget = process.env.BUN_TARGET || TARGETS[triple];
if (!bunTarget) {
  console.error(`unknown target ${triple}; expected one of ${Object.keys(TARGETS).join(', ')}`);
  process.exit(2);
}
const exe = triple.includes('windows') ? '.exe' : '';
const outfile = join(outDir, `agent-host-${triple}${exe}`);
mkdirSync(outDir, { recursive: true });

// @jarvis/providers is bundled when it resolves; otherwise it is left external and the sidecar starts
// without providers (it logs a warning and degrades gracefully).
const args = ['build', 'src/main.ts', '--compile', '--minify', `--target=${bunTarget}`, `--outfile=${outfile}`];
try {
  createRequire(join(pkgDir, 'package.json')).resolve('@jarvis/providers');
} catch {
  console.warn('warning: @jarvis/providers not resolvable — building without it');
  args.push('--external', '@jarvis/providers');
}

const bun = process.env.BUN_BIN || 'bun';
const r = spawnSync(bun, args, { cwd: pkgDir, stdio: 'inherit', shell: false });
if (r.status !== 0 || !existsSync(outfile)) {
  console.error('bun build failed');
  process.exit(r.status || 1);
}
console.log(`built ${outfile}`);
