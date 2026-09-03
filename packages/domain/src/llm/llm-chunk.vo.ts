/**
 * One increment of a model's streamed reply, in domain terms.
 *
 * Deliberately narrower than the UI's wire format: the wire envelope carries
 * chat and stream ids, which are assigned by the application. A provider that
 * had to invent stream ids would be a provider that knows about our chat
 * aggregate.
 */
export type LlmChunk =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; output: unknown }
  | { type: 'tool_error'; id: string; name: string; message: string }
  | { type: 'done' }
  | {
      type: 'error';
      reason: 'provider_error' | 'model_context_overflow' | 'unknown';
    };

export interface LlmMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface LlmChatRequest {
  model: string;
  messages: LlmMessage[];
  systemPrompt?: string;
  signal?: AbortSignal;
}
