#!/usr/bin/env node
/**
 * Builds a runnable Windows x64 Jarvis folder without a local MSVC/Rust build:
 *   1. the UI (Vite) and the sidecar (bun --compile) on the host;
 *   2. the Tauri shell in Docker with cargo-xwin;
 *   3. collects `dist-windows/` = jarvis-desktop.exe + agent-host.exe, ready for Windows Sandbox or another PC.
 * Usage: node scripts/windows-xbuild/build-windows.mjs [release|debug]
 * Env: JARVIS_XBUILD_IMAGE=<image> reuses a prepared image; JARVIS_XWIN_SDK=<dir> uses a local `xwin splat` output;
 *      JARVIS_SHERPA_ARCHIVES=<dir> provides the sherpa-onnx win-x64 archives offline.
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

// JARVIS_XBUILD_IMAGE reuses any image that already has rustup's windows-msvc target + cargo-xwin.
const image = process.env.JARVIS_XBUILD_IMAGE ?? 'jarvis-xbuild';
if (!process.env.JARVIS_XBUILD_IMAGE) run('docker', ['build', '-t', image, join(root, 'scripts/windows-xbuild')]);
run('docker', [
  'run',
  '--rm',
  '-e',
  'XWIN_ACCEPT_LICENSE=1',
  '-e',
  'CARGO_TARGET_DIR=/target',
  '-w',
  '/src/apps/desktop/src-tauri',
  '--entrypoint',
  'bash',
  '-v',
  `${root}:/src`,
  '-v',
  'jarvis-xbuild-target:/target',
  '-v',
  'jarvis-cargo-registry:/usr/local/cargo/registry',
  '-v',
  'jarvis-xbuild-xwin:/root/.cache/cargo-xwin',
  '-v',
  `${out}:/out`,
  // JARVIS_XWIN_SDK: an existing `xwin splat` output on the host → offline build, no SDK download in Docker.
  // JARVIS_SHERPA_ARCHIVES: folder with the sherpa-onnx Windows release archives → no GitHub download in Docker.
  ...(process.env.JARVIS_SHERPA_ARCHIVES
    ? ['-v', `${process.env.JARVIS_SHERPA_ARCHIVES}:/sherpa:ro`, '-e', 'SHERPA_ONNX_ARCHIVE_DIR=/sherpa']
    : []),
  ...(process.env.JARVIS_XWIN_SDK
    ? ['-v', `${process.env.JARVIS_XWIN_SDK}:/xwin-sdk:ro`, '-v', 'jarvis-xbuild-sdk:/opt/xwin']
    : []),
  image,
  '/src/scripts/windows-xbuild/build.sh',
  profile,
]);

const sidecar = join(root, 'apps/desktop/src-tauri/binaries', `agent-host-${triple}.exe`);
if (!existsSync(sidecar)) throw new Error(`missing ${sidecar}`);
mkdirSync(out, { recursive: true });
copyFileSync(sidecar, join(out, 'agent-host.exe'));
rmSync(join(out, '.gitkeep'), { force: true });
console.log(`\n✔ ${out}\\jarvis-desktop.exe + agent-host.exe`);
