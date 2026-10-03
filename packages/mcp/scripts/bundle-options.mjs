// esbuild options for the single-file `jarvis-mcp` bundle. Shared by scripts/build.mjs and by
// test/bundle.test.ts, which checks that the copy committed in the Claude plugin is up to date.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Where the bundle is written: the npm/release artefact and the copy shipped inside the Claude plugin. */
export const bundleOutputs = [
  join(packageRoot, 'dist', 'jarvis-mcp.mjs'),
  join(packageRoot, 'integrations', 'claude-plugin', 'server', 'jarvis-mcp.mjs'),
];

export const bundleOptions = {
  entryPoints: [join(packageRoot, 'src', 'cli.ts')],
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
  logLevel: 'warning',
};
