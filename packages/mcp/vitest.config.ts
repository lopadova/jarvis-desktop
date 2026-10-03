import { defineProject } from 'vitest/config';

export default defineProject({ test: { name: 'mcp', include: ['test/**/*.test.ts'] } });
