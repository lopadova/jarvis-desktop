import { z } from 'zod';

export const ROUTER_ACTIONS = [
  'answer',
  'spawn',
  'followup',
  'cancel',
  'status',
  'open',
  'clarify',
  'create_project',
  'reminder',
] as const;

export const RouterActionSchema = z.object({
  action: z.enum(ROUTER_ACTIONS),
  speak: z.string(),
  agent: z.enum(['claude', 'codex', 'home']).nullable().optional(),
  project: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  task: z.string().nullable().optional(),
  coding: z.boolean().nullable().optional(),
  quickReplies: z.array(z.string()).max(4).nullable().optional(),
  reminder: z
    .object({ text: z.string().min(1), dueAt: z.string(), kind: z.enum(['reminder', 'timer', 'alarm']).optional() })
    .nullable()
    .optional(),
  remember: z.string().nullable().optional(),
  forget: z.object({ memoryId: z.string() }).nullable().optional(),
});

export type RouterAction = z.infer<typeof RouterActionSchema>;

/** JSON Schema handed to brains that support structured outputs (kept in sync with the zod schema by a test). */
export const routerJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: [...ROUTER_ACTIONS] },
    speak: { type: 'string' },
    agent: { type: ['string', 'null'], enum: ['claude', 'codex', 'home', null] },
    project: { type: ['string', 'null'] },
    sessionId: { type: ['string', 'null'] },
    task: { type: ['string', 'null'] },
    coding: { type: ['boolean', 'null'] },
    quickReplies: { type: ['array', 'null'], items: { type: 'string' }, maxItems: 4 },
    reminder: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        text: { type: 'string' },
        dueAt: { type: 'string' },
        kind: { type: 'string', enum: ['reminder', 'timer', 'alarm'] },
      },
      required: ['text', 'dueAt', 'kind'],
    },
    remember: { type: ['string', 'null'] },
    forget: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: { memoryId: { type: 'string' } },
      required: ['memoryId'],
    },
  },
  required: [
    'action',
    'speak',
    'agent',
    'project',
    'sessionId',
    'task',
    'coding',
    'quickReplies',
    'reminder',
    'remember',
    'forget',
  ],
} as const;

/** Extract the outermost JSON object from free text (models sometimes wrap JSON in prose or fences). */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export type ParseResult = { ok: true; action: RouterAction } | { ok: false; error: string };

export function parseRouterAction(raw: unknown): ParseResult {
  let value = raw;
  if (typeof raw === 'string') {
    const json = extractJsonObject(raw);
    if (!json) return { ok: false, error: 'no JSON object found' };
    try {
      value = JSON.parse(json);
    } catch (e) {
      return { ok: false, error: `invalid JSON: ${(e as Error).message}` };
    }
  }
  const r = RouterActionSchema.safeParse(value);
  if (!r.success)
    return { ok: false, error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  return { ok: true, action: r.data };
}
