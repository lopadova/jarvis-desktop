import type { Env as RelayEnv } from '../src/env.js';

declare global {
  namespace Cloudflare {
    interface Env extends RelayEnv {}
  }
}
