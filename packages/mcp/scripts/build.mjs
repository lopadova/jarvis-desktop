// Bundles the `jarvis-mcp` CLI into a single dependency-free ESM file (Node ≥ 20) and writes it to
// dist/ and into the Claude plugin (integrations/claude-plugin/server/, committed so the plugin
// installs straight from the GitHub marketplace without downloading anything from npm).
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { build } from 'esbuild';
import { bundleOptions, bundleOutputs } from './bundle-options.mjs';

const result = await build({ ...bundleOptions, write: false, outfile: bundleOutputs[0] });
const code = result.outputFiles[0].contents;

for (const outfile of bundleOutputs) {
  await mkdir(dirname(outfile), { recursive: true });
  await writeFile(outfile, code);
  await chmod(outfile, 0o755);
  console.log(`Wrote ${outfile} (${Math.round(code.byteLength / 1024)} KB)`);
}
