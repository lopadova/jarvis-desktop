// Bundles the `jarvis-mcp` CLI into a single dependency-free ESM file (Node ≥ 20).
import { chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = join(root, 'dist', 'jarvis-mcp.mjs');

await build({
  entryPoints: [join(root, 'src', 'cli.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  // `ws` optionally loads native accelerators; they are not needed.
  external: ['bufferutil', 'utf-8-validate'],
  banner: {
    // Some bundled CommonJS dependencies call require() for Node built-ins.
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __jarvisCreateRequire } from 'node:module';",
      'const require = __jarvisCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  logLevel: 'info',
});
await chmod(outfile, 0o755);
