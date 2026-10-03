import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'agent-host', include: ['test/**/*.test.ts'], testTimeout: 15_000 },
});
