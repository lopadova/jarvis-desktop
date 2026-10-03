import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { bundleOptions, bundleOutputs } from '../scripts/bundle-options.mjs';

describe('Claude plugin bundle', () => {
  it('ships an up-to-date server/jarvis-mcp.mjs (run `pnpm --filter @jarvis/mcp build` and commit if this fails)', async () => {
    const fresh = await build({ ...bundleOptions, write: false, outfile: bundleOutputs[0], logLevel: 'silent' });
    const committed = await readFile(bundleOutputs[1] ?? '', 'utf8');
    expect(committed === fresh.outputFiles?.[0]?.text).toBe(true);
  }, 60_000);

  it('runs the bundled server locally (no npm download at launch)', async () => {
    const mcpJson = JSON.parse(
      await readFile(new URL('../integrations/claude-plugin/.mcp.json', import.meta.url), 'utf8'),
    ) as { mcpServers: { jarvis: { command: string; args: string[] } } };
    expect(mcpJson.mcpServers.jarvis).toEqual({
      command: 'node',
      args: ['${CLAUDE_PLUGIN_ROOT}/server/jarvis-mcp.mjs'],
    });
  });
});
