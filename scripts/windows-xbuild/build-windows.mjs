#!/usr/bin/env node
/**
 * Builds a runnable Windows x64 Jarvis folder without a local MSVC/Rust build:
 *   1. the UI (Vite) and the sidecar (bun --compile) on the host;
 *   2. the Tauri shell in Docker with cargo-xwin;
 *   3. collects `dist-windows/` = jarvis-desktop.exe + agent-host.exe, ready for Windows Sandbox or another PC.
 * Usage: node scripts/windows-xbuild/build-windows.mjs [release|debug]
 * Requires Docker Desktop. cargo-xwin accepts Microsoft's CRT/SDK licence terms on your behalf (see Dockerfile).
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const profile = process.argv[2] === 'debug' ? 'debug' : 'release';
const triple = 'x86_64-pc-windows-msvc';
const out = join(root, 'dist-windows');

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });
  if (r.status !== 0) {
    console.error(`✖ ${cmd} exited with ${r.status ?? r.signal}`);
    process.exit(r.status ?? 1);
  }
}

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
run(pnpm, ['--filter', '@jarvis/desktop', 'build'], { shell: process.platform === 'win32' });
run(pnpm, ['sidecar:build'], {
  shell: process.platform === 'win32',
  env: { ...process.env, JARVIS_SIDECAR_TARGET: triple, BUN_TARGET: 'bun-windows-x64' },
});

run('docker', ['build', '-t', 'jarvis-xbuild', join(root, 'scripts/windows-xbuild')]);
run('docker', [
  'run',
  '--rm',
  '-v',
  `${root}:/src`,
  '-v',
  'jarvis-xbuild-target:/target',
  '-v',
  'jarvis-xbuild-cargo:/usr/local/cargo/registry',
  '-v',
  'jarvis-xbuild-xwin:/root/.cache/cargo-xwin',
  '-v',
  `${out}:/out`,
  'jarvis-xbuild',
  profile,
]);

const sidecar = join(root, 'apps/desktop/src-tauri/binaries', `agent-host-${triple}.exe`);
if (!existsSync(sidecar)) throw new Error(`missing ${sidecar}`);
mkdirSync(out, { recursive: true });
copyFileSync(sidecar, join(out, 'agent-host.exe'));
rmSync(join(out, '.gitkeep'), { force: true });
console.log(`\n✔ ${out}\\jarvis-desktop.exe + agent-host.exe`);
