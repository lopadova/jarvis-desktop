/**
 * Manual check of Windows Job Objects under Bun (not part of CI):
 *   bun run packages/agent-host/scripts/win-job-check.ts
 * Spawns a parent that starts a detached grandchild and exits at once — the case `taskkill /T` cannot
 * handle, because the tree link is gone — then kills the job and checks the grandchild is dead.
 */
import { spawn } from 'node:child_process';
import { OsProcessInspector } from '../src/process/proc.js';
import { loadWindowsJobApi } from '../src/process/win-job.js';

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const api = await loadWindowsJobApi();
console.log('job api:', api ? 'available' : 'unavailable');
const inspector = new OsProcessInspector('win32', api);
const node = process.platform === 'win32' ? 'node.exe' : 'node';
const grandchildCode = 'setInterval(() => {}, 1000)';
const parentCode = `const c = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchildCode)}], { detached: true, stdio: 'ignore' }); console.log(c.pid); c.unref(); setTimeout(() => process.exit(0), 300);`;
const parent = spawn(node, ['-e', parentCode], { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
inspector.adopt(parent.pid as number);
let out = '';
parent.stdout?.on('data', (d) => {
  out += d;
});
await new Promise((r) => parent.once('exit', r));
const gpid = Number(out.trim());
console.log('parent exited; grandchild', gpid, 'alive:', alive(gpid));
await inspector.killTree(parent.pid as number);
await sleep(500);
const ok = !alive(gpid);
console.log('after killTree, grandchild alive:', !ok);
if (!ok) process.kill(gpid);
console.log(ok ? 'PASS job object killed the orphaned grandchild' : 'FAIL');
process.exit(ok ? 0 : 1);
