/**
 * Helpers to drive the REAL Jarvis app (the built exe, its real assistant process) through WebView2's
 * remote-debugging port, using playwright-core. Used by scripts/e2e-app/*.mjs.
 *
 * The app is launched with a dedicated data dir (JARVIS_E2E_DATA, default ~/jarvis-e2e-data) so the tester's
 * real settings, memory and secrets are never touched.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

export const PORT = Number(process.env.JARVIS_E2E_CDP_PORT ?? 9222);
export const DATA = process.env.JARVIS_E2E_DATA ?? join(homedir(), 'jarvis-e2e-data');
export const OUT = resolve(process.env.JARVIS_E2E_OUT ?? 'e2e-out');
export const EXE = resolve(process.env.JARVIS_EXE ?? 'dist-windows/jarvis-desktop.exe');

mkdirSync(OUT, { recursive: true });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
export function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${String(detail).slice(0, 200)}` : ''}`);
  return ok;
}
export function summary() {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  return failed;
}

/** Starts the app (detached, survives this script) unless a debugging port is already answering. */
export async function ensureApp() {
  if (await alive()) return false;
  const child = spawn(EXE, [], {
    env: {
      ...process.env,
      JARVIS_DATA_DIR: DATA,
      // Run the assistant process from this checkout with Bun (signed) instead of the bundled binary, which
      // Windows Smart App Control blocks when unsigned. Set JARVIS_E2E_SIDECAR=binary to test the binary.
      ...(process.env.JARVIS_E2E_SIDECAR === 'binary' ? {} : { JARVIS_SIDECAR_REPO: resolve('.') }),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
      WEBVIEW2_USER_DATA_FOLDER: join(DATA, 'webview2'),
    },
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
  for (let i = 0; i < 60 && !(await alive()); i++) await sleep(500);
  return true;
}

async function alive() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    return r.ok;
  } catch {
    return false;
  }
}

export async function connect() {
  return chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
}

/** The page of a window by its hash route (#/home, #/pill, #/settings, #/onboarding, #/sessions). */
export async function pageFor(browser, route, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    for (const ctx of browser.contexts()) {
      for (const p of ctx.pages()) if (p.url().includes(`#/${route}`)) return p;
    }
    await sleep(300);
  }
  return null;
}

export const shot = async (page, name) => {
  if (page) await page.screenshot({ path: join(OUT, `${name}.png`) }).catch(() => {});
};

/** All chat text currently in the Home conversation. */
export const conversation = async (home) =>
  (
    await home
      .locator('section[aria-label="Conversation"]')
      .innerText()
      .catch(() => '')
  ).replace(/\n+/g, ' | ');

/** Types a message in the Home composer and presses Enter. */
export async function say(home, text) {
  const box = home.getByLabel('Message Jarvis');
  await box.click();
  await box.fill(text);
  await box.press('Enter');
}

/** Waits until `predicate(conversationText)` holds. Returns the text, or null on timeout. */
export async function waitConversation(home, predicate, timeoutMs = 90000) {
  const end = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < end) {
    last = await conversation(home);
    if (predicate(last)) return last;
    await sleep(500);
  }
  return null;
}

/** A UI-role connection to the running app's assistant process (endpoint obtained from the shell like the UI does). */
export async function sidecar(home) {
  const ep = await home.evaluate(() => window.__TAURI_INTERNALS__.invoke('sidecar_endpoint'));
  const { createRequire } = await import('node:module');
  const WebSocket = createRequire(join(process.cwd(), 'packages/mcp/package.json'))('ws');
  const ws = new WebSocket(`ws://127.0.0.1:${ep.port}/?role=ui`, [`jarvis.${ep.token}`]);
  await new Promise((r) => ws.once('open', r));
  const waiting = new Map();
  let id = 0;
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (m.id && waiting.has(m.id)) {
      waiting.get(m.id)(m);
      waiting.delete(m.id);
    }
  });
  return {
    call: (method, params) =>
      new Promise((res) => {
        const i = ++id;
        waiting.set(i, res);
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }));
      }),
    close: () => ws.close(),
  };
}

/** Reads `NAME=value` from a key file by name (values are never printed). */
export function readKey(file, name) {
  const line = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith(`${name}=`));
  if (!line) throw new Error(`${name}=… not found in the key file`);
  return line
    .slice(line.indexOf('=') + 1)
    .trim()
    .replace(/^["']|["']$/g, '');
}

/** Text appended to the assistant log since `fromSize` (used to see whether a TTS provider failed). */
export function logSince(fromSize) {
  const file = join(DATA, 'logs', 'app.log');
  const buf = readFileSync(file);
  return { size: buf.length, text: buf.subarray(fromSize).toString('utf8') };
}
export function logSize() {
  return logSince(0).size;
}
