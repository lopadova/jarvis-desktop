/** Debug helper: console errors + DOM state of a window. Usage: node scripts/e2e-app/debug-window.mjs settings */
import { connect, pageFor, sleep } from './lib.mjs';

const route = process.argv[2] ?? 'settings';
const b = await connect();
const p = await pageFor(b, route, 5000);
if (!p) {
  console.log(`no page for #/${route}`);
  process.exit(1);
}
const msgs = [];
p.on('console', (m) => msgs.push(`${m.type()}: ${m.text()}`));
p.on('pageerror', (e) => msgs.push(`PAGEERROR: ${e.message}`));
p.on('requestfailed', (r) => msgs.push(`REQFAILED: ${r.url()} ${r.failure()?.errorText}`));
await p.evaluate(() => location.reload()).catch((e) => msgs.push(`evalerr ${e.message}`));
await sleep(5000);
console.log('root children:', await p.evaluate(() => document.getElementById('root')?.children.length).catch(() => 'n/a'));
console.log('text:', JSON.stringify((await p.locator('body').innerText().catch(() => '')).slice(0, 300)));
console.log(msgs.slice(0, 15).join('\n'));
await b.close();
