// Copies src/shared/*.ts (runtime-agnostic protocol code) into vercel/src/shared/ so the Vercel
// project stays self-contained ("Deploy with Vercel" clones only packages/relay/vercel).
// vercel/test/shared-sync.test.ts fails when the copies drift.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'src', 'shared');
const to = join(root, 'vercel', 'src', 'shared');
mkdirSync(to, { recursive: true });
for (const file of readdirSync(from).filter((name) => name.endsWith('.ts'))) {
  copyFileSync(join(from, file), join(to, file));
  console.log(`synced ${file}`);
}
