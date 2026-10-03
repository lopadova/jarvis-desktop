/** Shared OpenAI Responses API streaming client (used by `chatgpt` plan tokens and `api-openai`). */
import { type BrainRequest, type BrainResponse, ProviderError } from '@jarvis/core';
import { bodyChunks, type ErrorBody, fetchRetry, readErrorBody } from '../util/http.js';
import { tryParseJson } from '../util/json.js';
import { sseJson } from '../util/sse.js';

export const OPENAI_API_BASE = 'https://api.openai.com/v1';

export interface ResponsesCall {
  fetch: typeof fetch;
  url: string;
  headers: Record<string, string>;
  model: string;
  req: BrainRequest;
  /** Add `text.format` json_schema when req.jsonSchema is present. */
  structured: boolean;
  provider: string;
  signal: AbortSignal;
}

/** Thrown for HTTP-level (pre-stream) and in-stream failures; carries the raw error for provider-specific mapping. */
export class ResponsesHttpError extends Error {
  constructor(
    readonly body: ErrorBody,
    readonly inStream: boolean,
  ) {
    super(body.message);
    this.name = 'ResponsesHttpError';
  }
}

export function responsesBody(model: string, req: BrainRequest, structured: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    input: req.messages.map((m) => ({ role: m.role === 'system' ? 'developer' : m.role, content: m.content })),
    store: false,
    stream: true,
  };
  if (structured && req.jsonSchema) {
    body.text = {
      format: {
        type: 'json_schema',
        name: 'jarvis_response',
        schema: req.jsonSchema,
        strict: req.jsonSchema.additionalProperties === false,
      },
    };
  }
  return body;
}

/**
 * POSTs to /responses with `stream:true` and consumes the SSE stream. Success only after
 * `response.completed`; `response.failed` / `response.incomplete` / `error` events and a stream
 * that ends early all throw.
 */
export async function streamResponses(call: ResponsesCall): Promise<BrainResponse> {
  const res = await fetchRetry(
    call.fetch,
    call.url,
    {
      method: 'POST',
      headers: { ...call.headers, 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(responsesBody(call.model, call.req, call.structured)),
      signal: call.signal,
    },
    call.provider,
  );
  if (!res.ok) throw new ResponsesHttpError(await readErrorBody(res), false);

  let text = '';
  let completed = false;
  let usage: BrainResponse['usage'];
  for await (const { json } of sseJson(bodyChunks(res))) {
    const type = json.type;
    if (type === 'response.output_text.delta' && typeof json.delta === 'string') {
      text += json.delta;
      call.req.onDelta?.(json.delta);
    } else if (type === 'response.completed') {
      completed = true;
      const response = (json.response ?? {}) as Record<string, unknown>;
      const u = response.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      if (u) usage = { inputTokens: u.input_tokens, outputTokens: u.output_tokens };
      if (!text) text = outputText(response);
      break;
    } else if (type === 'response.failed' || type === 'response.incomplete' || type === 'error') {
      const response = (json.response ?? {}) as Record<string, unknown>;
      const err = (response.error ?? json.error ?? json) as Record<string, unknown>;
      const details = response.incomplete_details as { reason?: string } | undefined;
      throw new ResponsesHttpError(
        {
          status: 0,
          code: (err.code as string | undefined) ?? (type === 'response.incomplete' ? 'incomplete' : undefined),
          message:
            (err.message as string | undefined) ??
            (details?.reason ? `Response incomplete: ${details.reason}` : `Stream reported ${String(type)}`),
        },
        true,
      );
    }
  }
  if (!completed) throw new ProviderError('Stream ended before response.completed', 'bad-response', call.provider);
  const out: BrainResponse = { text };
  if (usage) out.usage = usage;
  if (call.req.jsonSchema) {
    const parsed = tryParseJson(text);
    if (parsed !== undefined) out.json = parsed;
  }
  return out;
}

function outputText(response: Record<string, unknown>): string {
  const output = Array.isArray(response.output) ? response.output : [];
  let s = '';
  for (const item of output as Array<Record<string, unknown>>) {
    if (item.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content as Array<Record<string, unknown>>) {
      if (part.type === 'output_text' && typeof part.text === 'string') s += part.text;
    }
  }
  return s;
}

/** True when a failure looks like the server rejecting `text.format` (structured output unsupported). */
export function isStructuredOutputRejection(e: ResponsesHttpError): boolean {
  if (e.body.code === 'subscription_sharing_unsupported_capability') return true;
  if (e.body.status !== 400) return false;
  return /text\.format|json_schema|response_format|structured/i.test(e.body.message);
}
