/**
 * Stage 2 — every window and every Settings tab of the REAL app must render (no blank windows, no page errors).
 * This caught: a Settings window stuck on about:blank (window created on the event-loop thread) and a blank page
 * caused by a library assigning `toString` while Tauri freezes Object.prototype.
 * Usage: node scripts/e2e-app/02-windows.mjs
 */
import { check, connect, ensureApp, pageFor, shot, sleep, summary } from './lib.mjs';

await ensureApp();
const browser = await connect();
await sleep(3000);

const errors = [];
const watch = (page, label) => {
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
};

const renders = async (page) =>
  (await page.evaluate(() => document.getElementById('root')?.children.length ?? 0).catch(() => 0)) > 0 &&
  (await page.locator('body').innerText().catch(() => '')).trim().length > 10;

// Home
const home = await pageFor(browser, 'home');
watch(home, 'home');
await home.bringToFront();
check('Home renders', await renders(home));

// Settings through the rail (a real click, as a user would)
await home.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Settings' }).click();
const settings = await pageFor(browser, 'settings', 20000);
check('Settings window opens and loads its page', !!settings, settings?.url());
if (settings) {
  watch(settings, 'settings');
  await settings.bringToFront();
  await sleep(2500);
  check('Settings renders', await renders(settings));
  const tabs = ['General', 'Brain & accounts', 'Agents & projects', 'Voice', 'Microphone & wake word', 'Privacy', 'Integrations', 'Shortcuts', 'About'];
  for (const t of tabs) {
    const el = settings.getByText(t, { exact: true }).first();
    const visible = await el.isVisible().catch(() => false);
    if (visible) await el.click().catch(() => {});
    await sleep(700);
    const ok = visible && (await renders(settings));
    check(`Settings › ${t} renders`, ok);
    await shot(settings, `windows-settings-${t.toLowerCase().replace(/[^a-z]+/g, '-')}`);
  }
}

// Sessions panel via its button
await home.bringToFront();
await home.getByRole('button', { name: /Sessions/ }).first().click().catch(() => {});
const sessions = await pageFor(browser, 'sessions', 8000);
check('Sessions panel opens', !!sessions);
if (sessions) {
  watch(sessions, 'sessions');
  await sleep(1500);
  check('Sessions panel renders', await renders(sessions));
  await shot(sessions, 'windows-sessions');
}

check('no uncaught page errors in any window', errors.length === 0, errors.join(' | '));
await browser.close();
process.exit(summary() ? 1 : 0);
