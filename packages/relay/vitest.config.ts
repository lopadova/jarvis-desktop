// @cloudflare/vitest-pool-workers 0.22 requires vitest 4.1.x, so this package pins vitest ~4.1 locally
// (the rest of the monorepo uses vitest 5) and is excluded from the root vitest workspace.
// Run with: pnpm --filter @jarvis/relay test
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            // Short limits so timeout and rate-limit paths are fast to exercise.
            // The pool's bundled workerd lags the deployed runtime; pin a date it supports for tests.
            miniflare: {
              compatibilityDate: '2026-08-15',
              bindings: { CALL_TIMEOUT_MS: '400', CALLS_PER_MINUTE: '5' },
            },
          }),
        ],
        test: { name: 'relay-worker', include: ['test/**/*.test.ts'] },
      },
      {
        test: { name: 'relay-vercel', environment: 'node', include: ['vercel/test/**/*.test.ts'] },
      },
    ],
  },
});
