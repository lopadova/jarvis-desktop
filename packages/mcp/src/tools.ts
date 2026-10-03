/**
 * MCP tool catalogue derived from `@jarvis/core` `McpTools`.
 *
 * The zod schemas in core are the single source of truth: names, descriptions, read-only and
 * destructive flags all come from there. This module only adds human-readable titles and converts
 * the zod params to JSON Schema (zod 4 `z.toJSONSchema`, input side so defaulted fields stay optional).
 */
import { type McpToolName, McpTools } from '@jarvis/core';
import { z } from 'zod';

export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolDefinition {
  name: McpToolName;
  title: string;
  description: string;
  inputSchema: { type: 'object'; [key: string]: unknown };
  annotations: ToolAnnotations;
}

/** Short titles shown by MCP clients next to each tool. */
export const TOOL_TITLES: Record<McpToolName, string> = {
  jarvis_speak: 'Speak out loud',
  jarvis_ask_user: 'Ask the user out loud',
  jarvis_notify: 'Show a desktop notification',
  jarvis_start_task: 'Start a background task',
  jarvis_list_sessions: 'List Jarvis sessions',
  jarvis_session_result: 'Get a session result',
  jarvis_remember: 'Remember a fact',
  jarvis_recall: 'Recall remembered facts',
};

/** Tools that read state without changing anything are safe to retry. */
const IDEMPOTENT: ReadonlySet<McpToolName> = new Set([
  'jarvis_list_sessions',
  'jarvis_session_result',
  'jarvis_recall',
]);

export const TOOL_NAMES = Object.keys(McpTools) as McpToolName[];

export function isToolName(name: string): name is McpToolName {
  return Object.hasOwn(McpTools, name);
}

/** JSON Schema for a tool's arguments (no `$schema` key: MCP clients assume 2020-12). */
export function toolInputSchema(name: McpToolName): ToolDefinition['inputSchema'] {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(McpTools[name].params, { io: 'input' }) as Record<
    string,
    unknown
  >;
  return { ...schema, type: 'object' };
}

export function toolDefinition(name: McpToolName): ToolDefinition {
  const tool = McpTools[name];
  const title = TOOL_TITLES[name];
  return {
    name,
    title,
    description: tool.description,
    inputSchema: toolInputSchema(name),
    annotations: {
      title,
      readOnlyHint: tool.readOnly,
      destructiveHint: tool.destructive,
      idempotentHint: IDEMPOTENT.has(name),
      openWorldHint: false,
    },
  };
}

export function toolDefinitions(): ToolDefinition[] {
  return TOOL_NAMES.map(toolDefinition);
}

/** `jarvis_ask_user` waits for a human answer (up to 600 s); everything else should be quick. */
export function toolTimeoutMs(name: McpToolName): number {
  return name === 'jarvis_ask_user' ? 600_000 : 30_000;
}
