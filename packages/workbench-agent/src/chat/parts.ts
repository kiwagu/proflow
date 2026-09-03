/**
 * @file The renderable shape of an assistant turn.
 *
 * The domain's `LlmChunk` is a provider increment; a chat surface renders
 * parts. The two differ in granularity, not in content: a reply arrives as
 * hundreds of text chunks and is read as a handful of paragraphs, tool
 * calls and results. This module is the one place that translates between
 * them, so nothing upstream of it knows about chats and nothing downstream
 * knows about providers.
 */
import type {
  ChatMessage,
  LlmChunk,
  StoredMessagePart,
} from '@workspace/domain';

export type AssistantPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool-call'; id: string; name: string; input: unknown }
  | { type: 'tool-result'; id: string; name: string; output: unknown }
  | { type: 'tool-error'; id: string; name: string; message: string };

/** A message as a surface renders it: a user line, or an assistant's parts. */
export interface RenderableMessage {
  id: string;
  role: 'user' | 'assistant';
  /** Assistant turns render parts; a user message renders its text. */
  text: string;
  parts: AssistantPart[];
  status: ChatMessage['status'];
}

/** The mark shown under a reply the user stopped. Never persisted. */
export const INTERRUPTED_MARK = '\n\n_Interrupted_';

/** A provider chunk as a renderable part, or `null` when it carries none. */
export function toPart(chunk: LlmChunk): AssistantPart | null {
  switch (chunk.type) {
    case 'text':
      return { type: 'text', text: chunk.text };
    case 'thinking':
      return { type: 'thinking', thinking: chunk.thinking };
    case 'tool_call':
      return {
        type: 'tool-call',
        id: chunk.id,
        name: chunk.name,
        input: chunk.input,
      };
    case 'tool_result':
      return {
        type: 'tool-result',
        id: chunk.id,
        name: chunk.name,
        output: chunk.output,
      };
    case 'tool_error':
      return {
        type: 'tool-error',
        id: chunk.id,
        name: chunk.name,
        message: chunk.message,
      };
    default:
      return null;
  }
}

/**
 * Coalesces adjacent parts of the same streamable kind.
 *
 * Parts are persisted at streaming granularity — one row per flush — because
 * that is what makes an interrupted turn recoverable. Read back raw, a reply
 * becomes one paragraph per chunk. The live view merges adjacent text as it
 * streams, so reading from storage must merge the same way, or a reloaded
 * transcript looks different from the one the user watched arrive.
 */
export function coalesceParts(parts: AssistantPart[]): AssistantPart[] {
  const out: AssistantPart[] = [];
  for (const part of parts) {
    const last = out.at(-1);
    if (last?.type === 'text' && part.type === 'text') {
      out[out.length - 1] = { type: 'text', text: last.text + part.text };
    } else if (last?.type === 'thinking' && part.type === 'thinking') {
      out[out.length - 1] = {
        type: 'thinking',
        thinking: last.thinking + part.thinking,
      };
    } else {
      out.push(part);
    }
  }
  return out;
}

function isAssistantPart(part: StoredMessagePart): boolean {
  const type = part.type;
  return (
    type === 'text' ||
    type === 'thinking' ||
    type === 'tool-call' ||
    type === 'tool-result' ||
    type === 'tool-error'
  );
}

/** A stored transcript row in the shape a surface renders. */
export function toRenderableMessage(message: ChatMessage): RenderableMessage {
  const role = message.role === 'assistant' ? 'assistant' : 'user';
  if (role !== 'assistant') {
    return {
      id: message.id,
      role,
      text: message.text,
      parts: [],
      status: message.status,
    };
  }
  const parts = coalesceParts(
    message.parts
      .slice()
      .sort((a, b) => a.idx - b.idx)
      .filter(isAssistantPart)
      .map((part) => part.data as unknown as AssistantPart)
  );
  if (message.status === 'interrupted') {
    parts.push({ type: 'text', text: INTERRUPTED_MARK });
  }
  return {
    id: message.id,
    role,
    text: message.text,
    parts,
    status: message.status,
  };
}
