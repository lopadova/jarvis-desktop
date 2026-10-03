import { connect, conversation, ensureApp, pageFor, say, sleep } from './lib.mjs';

await ensureApp();
const browser = await connect();
await sleep(2500);
const home = await pageFor(browser, 'home');
await home.bringToFront();
const dump = async (label) => console.log(`--- ${label}\n${(await conversation(home)).slice(-700)}\n`);

await say(home, 'what time is it');
await sleep(1500);
await dump('before delete');
await say(home, "delete today's history");
await sleep(2500);
await dump('right after delete');
await home.reload();
await sleep(3000);
await dump('after reloading the window');
await browser.close();
