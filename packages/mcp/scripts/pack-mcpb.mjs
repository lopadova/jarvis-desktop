// Packs the Claude Desktop extension: dist/jarvis-mcp.mjs → integrations/claude-desktop/server/ → dist/jarvis.mcpb
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = join(root, 'dist', 'jarvis-mcp.mjs');
const extensionDir = join(root, 'integrations', 'claude-desktop');
const output = join(root, 'dist', 'jarvis.mcpb');

if (!existsSync(bundle)) execFileSync(process.execPath, [join(root, 'scripts', 'build.mjs')], { stdio: 'inherit' });

const serverDir = join(extensionDir, 'server');
rmSync(serverDir, { recursive: true, force: true });
mkdirSync(serverDir, { recursive: true });
copyFileSync(bundle, join(serverDir, 'jarvis-mcp.mjs'));

// Use the pinned, locally installed @anthropic-ai/mcpb CLI (devDependency); never fetch one at pack time.
const localCli = join(root, 'node_modules', '@anthropic-ai', 'mcpb', 'dist', 'cli', 'cli.js');
if (!existsSync(localCli)) throw new Error('@anthropic-ai/mcpb is not installed: run `pnpm install` first');
const run = (...args) => execFileSync(process.execPath, [localCli, ...args], { stdio: 'inherit', cwd: root });

run('validate', join(extensionDir, 'manifest.json'));
rmSync(output, { force: true });
run('pack', extensionDir, output);
rmSync(serverDir, { recursive: true, force: true }); // build artefact: keep it out of the source tree
console.log(`\nPacked ${output}`);
