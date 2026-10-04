/**
 * Stage 8 — Sign in with ChatGPT through the real app. Presses the button in Settings › Brain & accounts; the
 * system browser opens and THE USER completes the login. The script then waits for the status to turn connected
 * and asks one question through the ChatGPT plan brain.
 * Usage: node scripts/e2e-app/08-chatgpt-signin.mjs
 */
import {
  check,
  connect,
  conversation,
  ensureApp,
  pageFor,
  say,
  shot,
  sleep,
  summary,
  waitConversation,
} from './lib.mjs';

await ensureApp();
const browser = await connect();
await sleep(3000);
const home = await pageFor(browser, 'home');
await home.bringToFront();
await home.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Settings' }).click();
const settings = await pageFor(browser, 'settings', 20000);
await settings.bringToFront();
await sleep(1500);
await settings.getByText('Brain & accounts', { exact: true }).first().click();
await sleep(1200);
await shot(settings, 'chatgpt-0-brain-tab');

const btn = settings.getByRole('button', { name: 'Sign in', exact: true }).first();
check('ChatGPT "Sign in" button is present', await btn.isVisible().catch(() => false));
await btn.click();
console.log('>>> Browser should open now: complete the ChatGPT login there (waiting up to 5 minutes).');

let connected = false;
for (let i = 0; i < 150 && !connected; i++) {
  await sleep(2000);
  // The ChatGPT row loses its "Sign in" button once the account is connected.
  connected = !(await btn.isVisible().catch(() => true));
}
await shot(settings, 'chatgpt-1-after-login');
check('ChatGPT sign-in completed (provider connected)', connected);

if (connected) {
  await home.bringToFront();
  await say(home, 'What is the capital of Italy? Answer with just the city name.');
  const hit = await waitConversation(home, (c) => /rome|roma/i.test(c), 120000);
  check('the ChatGPT plan brain answered', !!hit, hit ? hit.slice(-100) : (await conversation(home)).slice(-200));
}
await browser.close();
process.exit(summary() ? 1 : 0);
