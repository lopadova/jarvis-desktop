import { describe, expect, it } from 'vitest';
import { TOOL_CATALOG } from '../../relay/src/shared/catalog.generated.js';
import { toolDefinitions } from '../src/tools.js';

describe('relay tool catalogue', () => {
  it('matches @jarvis/core McpTools (run `pnpm --filter @jarvis/mcp gen:relay` if this fails)', () => {
    expect(JSON.parse(JSON.stringify(TOOL_CATALOG))).toEqual(JSON.parse(JSON.stringify(toolDefinitions())));
  });
});
