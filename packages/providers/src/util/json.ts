/**
 * Best-effort JSON extraction from model text (plain JSON, fenced ```json blocks or the first
 * balanced object). Returns undefined when nothing parses — the core router validates and repairs.
 */
export function tryParseJson(text: string): unknown {
  const t = text.trim();
  if (!t) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    // fall through
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // fall through
    }
  }
  const start = t.indexOf('{');
  if (start === -1) return undefined;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(t.slice(start, i + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Appends a JSON-only instruction for providers that cannot enforce a schema natively. */
export function jsonInstruction(schema: Record<string, unknown>): string {
  return `Reply with a single JSON object that matches this JSON Schema, and nothing else:\n${JSON.stringify(schema)}`;
}
