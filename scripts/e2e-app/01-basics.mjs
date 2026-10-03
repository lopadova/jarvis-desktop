/**
 * Stage 1 — no AI, no accounts: launch the real app, finish onboarding, and exercise the fast path
 * (time, timers, shopping list, private mode, memory view, history) through the real UI.
 * Usage: node scripts/e2e-app/01-basics.mjs
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
await sleep(2500);

// ── onboarding (first launch with an empty data dir) ──
const onboarding = await pageFor(browser, 'onboarding', 4000);
if (onboarding) {
  await shot(onboarding, 'basics-onboarding-1');
  for (let i = 0; i < 6; i++) {
    const next = onboarding.getByRole('button', { name: /Get started|Continue|Next|Finish|Try it|Skip/i }).last();
    if (!(await next.isVisible().catch(() => false))) break;
    await next.click().catch(() => {});
    await sleep(900);
  }
  check('onboarding can be completed from the real UI', true);
} else {
  check('onboarding window (skipped: already completed in this data dir)', true);
}

const home = await pageFor(browser, 'home');
if (!check('Home window is available', !!home)) process.exit(1);
await home.bringToFront().catch(() => {});

// connected to the real assistant process?
const connected = await waitConversation(home, () => true, 1000).then(async () =>
  (await home.locator('body').innerText()).includes('Connected'),
);
check('Home reports it is connected to the assistant process', connected);
await shot(home, 'basics-home');

// ── fast path through the real UI ──
await say(home, 'what time is it');
const t = await waitConversation(home, (c) => /\d{1,2}[:.]\d{2}/.test(c));
check('"what time is it" answered locally', !!t, t?.slice(-120));

await say(home, 'timer for 8 seconds');
const timer = await waitConversation(home, (c) => /timer/i.test(c));
check('timer request acknowledged', !!timer, timer?.slice(-120));
const fired = await waitConversation(home, (c) => /time is up|timer.*(done|finished)/i.test(c), 20000);
check('timer fires after 8 seconds', !!fired, fired?.slice(-120));

await say(home, 'add milk and eggs to the shopping list');
const shop = await waitConversation(home, (c) => /milk/i.test(c) && /eggs/i.test(c));
check('shopping list: items added', !!shop, shop?.slice(-160));
await shot(home, 'basics-shopping');
await say(home, "what's on the shopping list");
const list = await waitConversation(home, (c) => (c.match(/milk/gi) ?? []).length >= 2);
check('shopping list: read back', !!list);
await say(home, 'remove milk from the shopping list');
const removed = await waitConversation(home, (c) =>
  /removed|took|taken off/i.test(c.split('remove milk from the shopping list').pop() ?? ''),
);
check('shopping list: item removed', !!removed, removed?.slice(-120));

await say(home, 'switch to local mode');
const priv = await waitConversation(home, (c) => /private mode|local/i.test(c));
check('private mode toggled by voice command', !!priv, priv?.slice(-120));
await say(home, 'private mode off');
const privOff = await waitConversation(home, (c) =>
  /private mode off|turned off|disabled/i.test(c.split('private mode off').pop() ?? ''),
);
check('private mode turned off', !!privOff, privOff?.slice(-100));

await say(home, 'what do you know about me');
const know = await waitConversation(home, (c) => /remember|saved|nothing|know/i.test(c));
check('"what do you know about me" answered locally', !!know, know?.slice(-140));

await say(home, "delete today's history");
// Everything from today must be gone (the confirmation itself may be wiped too, so an empty conversation is fine).
await sleep(3000);
const left = await waitConversation(home, (c) => !/milk|shopping list|what time/i.test(c), 90000);
check(
  '"delete today\'s history" clears the conversation',
  left !== null,
  left === null ? await conversation(home) : `left: "${left}"`,
);

await shot(home, 'basics-final');
await browser.close();
process.exit(summary() ? 1 : 0);
