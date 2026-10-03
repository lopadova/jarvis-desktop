export interface SseEvent {
  event?: string;
  data: string;
}

/** Minimal, spec-compliant Server-Sent Events parser over a byte stream. */
export async function* parseSse(chunks: AsyncIterable<Uint8Array>): AsyncIterable<SseEvent> {
  const decoder = new TextDecoder();
  let buf = '';
  let event: string | undefined;
  let data: string[] = [];

  const flushLine = function* (line: string): Generator<SseEvent> {
    if (line === '') {
      if (data.length > 0) yield event === undefined ? { data: data.join('\n') } : { event, data: data.join('\n') };
      event = undefined;
      data = [];
      return;
    }
    if (line.startsWith(':')) return;
    const idx = line.indexOf(':');
    const field = idx === -1 ? line : line.slice(0, idx);
    let value = idx === -1 ? '' : line.slice(idx + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  };

  for await (const chunk of chunks) {
    buf += decoder.decode(chunk, { stream: true });
    let nl = buf.search(/\r\n|\r|\n/);
    while (nl !== -1) {
      const line = buf.slice(0, nl);
      const sepLen = buf.startsWith('\r\n', nl) ? 2 : 1;
      buf = buf.slice(nl + sepLen);
      yield* flushLine(line);
      nl = buf.search(/\r\n|\r|\n/);
    }
  }
  buf += decoder.decode();
  if (buf.length > 0) yield* flushLine(buf);
  yield* flushLine('');
}

/** Parses each SSE data payload as JSON, skipping `[DONE]` sentinels and malformed lines. */
export async function* sseJson(
  chunks: AsyncIterable<Uint8Array>,
): AsyncIterable<{ event?: string; json: Record<string, unknown> }> {
  for await (const ev of parseSse(chunks)) {
    if (ev.data === '[DONE]') return;
    try {
      const json = JSON.parse(ev.data) as unknown;
      if (json && typeof json === 'object')
        yield ev.event === undefined
          ? { json: json as Record<string, unknown> }
          : { event: ev.event, json: json as Record<string, unknown> };
    } catch {
      // keep-alive or non-JSON payload: ignore
    }
  }
}
