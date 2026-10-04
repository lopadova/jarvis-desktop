/**
 * Stage 11 — the UI gaps found by a real user: History says where to delete, Memory can be added to, Projects can be
 * added/removed, Settings autosave note, voice provider rows, enabled "Install extension", About links, model list.
 * Usage: node scripts/e2e-app/11-ui-features.mjs
 */
import { join } from 'node:path';
import { check, connect, ensureApp, pageFor, shot, sidecar, sleep, summary } from './lib.mjs';

await ensureApp();
const browser = await connect();
await sleep(3000);
const home = await pageFor(browser, 'home');
await home.bringToFront();
// The selectors below are English: switch the UI language for the run and put the user's language back at the end.
const api = await sidecar(home);
const previousLocale = (await api.call('settings.get', {})).result?.settings?.locale ?? 'en';
await api.call('settings.update', { patch: { locale: 'en' } });
await sleep(1500);
const nav = home.getByRole('navigation', { name: 'Main navigation' });

// ── History: where to delete + direct link
await nav.getByRole('button', { name: 'History' }).click();
await sleep(1200);
const histText = await home.locator('body').innerText();
// (an empty history shows the empty state; the hint is on the populated view, so make sure one turn exists)
if (!/Danger zone/i.test(histText)) {
  await nav.getByRole('button', { name: 'Home' }).click();
  const box = home.getByLabel('Message Jarvis');
  await box.fill('what time is it');
  await box.press('Enter');
  await sleep(2500);
  await nav.getByRole('button', { name: 'History' }).click();
  await sleep(1200);
}
const hasHint = /Danger zone/i.test(await home.locator('body').innerText());
check('History explains that deleting is done in Settings › Privacy › Danger zone', hasHint);
await shot(home, 'ui-history');

// ── Memory: add something
await nav.getByRole('button', { name: 'Memory' }).click();
await sleep(1000);
const fact = `e2e fact ${Date.now() % 100000}`;
await home.getByLabel('Something for Jarvis to remember…').fill(fact);
await home.getByRole('button', { name: 'Remember' }).click();
await sleep(1500);
check('Memory: a typed fact appears in the list', (await home.locator('body').innerText()).includes(fact));
await shot(home, 'ui-memory');

// ── Projects: add, see, remove
await nav.getByRole('button', { name: 'Projects' }).click();
await sleep(1000);
await home.getByLabel('Name', { exact: true }).fill('e2e-demo');
await home.getByLabel(/^Folder/).fill(join(process.env.TEMP ?? 'C:/Windows/Temp', 'e2e-demo-project'));
await home.getByRole('button', { name: 'Add project' }).click();
await sleep(1500);
check('Projects: the added project is listed', (await home.locator('body').innerText()).includes('e2e-demo'));
await shot(home, 'ui-projects');
const removeBtn = home.getByRole('button', { name: 'Remove' }).first();
await removeBtn.click();
await home.getByRole('button', { name: 'Click to confirm' }).first().click();
await sleep(1500);
check('Projects: the project can be removed', !(await home.locator('body').innerText()).includes('e2e-demo'));

// ── Settings
await nav.getByRole('button', { name: 'Settings' }).click();
const settings = await pageFor(browser, 'settings', 20000);
await settings.bringToFront();
await sleep(1500);
check(
  'Settings says changes are saved automatically',
  /saved automatically/i.test(await settings.locator('body').innerText()),
);

await settings.getByText('Voice', { exact: true }).first().click();
await sleep(1500);
const voiceText = await settings.locator('body').innerText();
check('Voice tab shows a status for the selected provider', /Ready|Needs setup/.test(voiceText));
await settings.locator('select').first().selectOption('openai');
await sleep(1500);
const openai = await settings.locator('body').innerText();
check(
  'Choosing OpenAI explains what it needs (key) and shows its status',
  /OpenAI API key/i.test(openai) && /Needs setup/.test(openai),
  openai.slice(0, 0),
);
await shot(settings, 'ui-voice-openai');
await settings.locator('select').first().selectOption('elevenlabs');
await sleep(1500);
const el = await settings.locator('body').innerText();
check(
  'ElevenLabs shows model, stability, similarity, style and speaker boost',
  /Eleven v3/.test(el) &&
    /Stability/.test(el) &&
    /Similarity/.test(el) &&
    /Style exaggeration/.test(el) &&
    /Speaker boost/.test(el),
);
await shot(settings, 'ui-voice-elevenlabs');
await settings.locator('select').first().selectOption('system');
await sleep(500);

await settings.getByText('Integrations', { exact: true }).first().click();
await sleep(1000);
const install = settings.getByRole('button', { name: /Install extension/i });
check('"Install extension" is enabled', await install.isEnabled());

await settings.getByText('Microphone & wake word', { exact: true }).first().click();
await sleep(1000);
await shot(settings, 'ui-microphone');

await settings.getByText('About', { exact: true }).first().click();
await sleep(800);
const notes = settings.getByRole('button', { name: /Release notes/i });
check('About: "Release notes" is a working button', await notes.isVisible());
const err = await settings
  .evaluate(() =>
    window.__TAURI_INTERNALS__.invoke('open_external', { url: 'file:///C:/Windows/System32/calc.exe' }).then(
      () => 'opened',
      (e) => String(e),
    ),
  )
  .catch((e) => String(e));
check('open_external refuses anything but project pages', err !== 'opened', err);

await api.call('settings.update', { patch: { locale: previousLocale } });
api.close();
await browser.close();
process.exit(summary() ? 1 : 0);
