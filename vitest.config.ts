import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // packages/relay runs in workerd via @cloudflare/vitest-pool-workers, which needs vitest 4.1:
    // it has its own config and is run with `pnpm --filter @jarvis/relay test`.
    projects: ['packages/*', '!packages/relay', 'apps/desktop'],
  },
});
