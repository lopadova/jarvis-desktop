import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('docs');
const allowedFence = /^```/;
const rawHtml = /<\/?[a-z][\w:-]*(?:\s[^>]*)?>/i;
const jsx = /<[A-Z][A-Za-z0-9]*(\s|>|\/>)/;
const leakedContainer = /:::/;
const generatedRoot = path.resolve('_site');

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await files(full));
    else if (entry.isFile() && full.endsWith('.md')) out.push(full);
  }
  return out;
}

const failures = [];
for (const file of await files(root)) {
  const text = await readFile(file, 'utf8');
  let inFence = false;
  for (const [idx, line] of text.split(/\r?\n/).entries()) {
    if (allowedFence.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (rawHtml.test(line)) failures.push(`${file}:${idx + 1}: raw HTML is not allowed`);
    if (jsx.test(line)) failures.push(`${file}:${idx + 1}: JSX/MDX syntax is not allowed`);
  }
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function htmlFiles(dir) {
  if (!await exists(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await htmlFiles(full));
    else if (entry.isFile() && full.endsWith('.html')) out.push(full);
  }
  return out;
}

for (const file of await htmlFiles(generatedRoot)) {
  const text = await readFile(file, 'utf8');
  if (leakedContainer.test(text)) failures.push(`${file}: visible docmd container marker leaked into HTML`);
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Markdown raw HTML guard passed.');
