/**
 * @file One model turn: streamed to the surface, persisted to the transcript.
 *
 * Streaming granularity and storage granularity are different needs. A
 * surface wants every chunk the moment it arrives; the database wants
 * durable parts, and a durable insert per chunk cannot keep up with a
 * stream. So the turn is double-written — live parts go to a callback,
 * text accumulates and is flushed to storage at a boundary — and what a
 * crash can lose is bounded by the flush threshold.
 */
import type {
  IChatMessageRepository,
  ILlmGateway,
  LlmChatRequest,
} from '@workspace/domain';
import type { AssistantPart } from './parts';
import { toPart } from './parts';

/** How much text may accumulate before it is written as one durable part. */
const FLUSH_AT = 512;

export interface TurnContext {
  chatId: string;
  messageId: string;
  streamId: string;
  model: string;
}

export interface TurnDeps {
  llm: ILlmGateway;
  messages: IChatMessageRepository;
  /** Every part as it arrives, at streaming granularity. */
  onPart: (part: AssistantPart) => void;
}

export type TurnStatus = 'complete' | 'error' | 'interrupted';

export interface TurnOutcome {
  status: TurnStatus;
  /** The reply's plain text, as persisted. */
  text: string;
  /** Why it failed, when it did. */
  error?: string;
}

/**
 * A stop must take effect now, not at the next chunk: a model may be inside
 * a long tool call when the user gives up on it. Each pull races the source
 * against the signal, so an abort ends the iteration at once.
 */
async function* abortable<T>(
  source: AsyncIterable<T>,
  signal: AbortSignal
): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]();
  const aborted = new Promise<{ done: true; value: undefined }>((resolve) => {
    signal.addEventListener(
      'abort',
      () => resolve({ done: true, value: undefined }),
      { once: true }
    );
  });
  try {
    while (!signal.aborted) {
      const next = await Promise.race([iterator.next(), aborted]);
      if (next.done) return;
      yield next.value;
    }
  } finally {
    void iterator.return?.();
  }
}

/**
 * Runs one turn to its end and settles it.
 *
 * Always settles: an aborted turn keeps what arrived and is recorded as
 * 'interrupted', a thrown one as 'error'. Nothing is left in 'streaming',
 * because a row in that state after the turn returns is a lie the next
 * session has to clean up.
 */
export async function runChatTurn(
  deps: TurnDeps,
  ctx: TurnContext,
  request: Omit<LlmChatRequest, 'signal'>,
  signal: AbortSignal
): Promise<TurnOutcome> {
  await deps.messages.beginAssistantMessage({
    id: ctx.messageId,
    chatId: ctx.chatId,
    model: ctx.model,
  });
  await deps.messages.beginStream({
    id: ctx.streamId,
    chatId: ctx.chatId,
    messageId: ctx.messageId,
  });

  let idx = 0;
  let text = '';
  let failure: string | undefined;
  let pendingText = '';
  let pendingThinking = '';

  const persist = async (part: AssistantPart) => {
    await deps.messages.appendPart({
      messageId: ctx.messageId,
      chatId: ctx.chatId,
      part: {
        idx: idx++,
        type: part.type,
        data: part as unknown as Record<string, unknown>,
      },
    });
  };

  const flush = async (kind: 'text' | 'thinking') => {
    const value = kind === 'text' ? pendingText : pendingThinking;
    if (!value) return;
    if (kind === 'text') pendingText = '';
    else pendingThinking = '';
    await persist(
      kind === 'text'
        ? { type: 'text', text: value }
        : { type: 'thinking', thinking: value }
    );
  };
  const flushAll = async () => {
    await flush('thinking');
    await flush('text');
  };

  let failed = false;
  let interrupted = false;
  try {
    for await (const chunk of abortable(
      deps.llm.streamChat({ ...request, signal }),
      signal
    )) {
      if (signal.aborted) break;
      if (chunk.type === 'done') break;
      if (chunk.type === 'error') {
        failed = true;
        failure = chunk.reason;
        break;
      }
      const part = toPart(chunk);
      if (!part) continue;

      deps.onPart(part);

      if (part.type === 'text') {
        text += part.text;
        pendingText += part.text;
        if (pendingText.length >= FLUSH_AT) await flush('text');
      } else if (part.type === 'thinking') {
        pendingThinking += part.thinking;
        if (pendingThinking.length >= FLUSH_AT) await flush('thinking');
      } else {
        // A tool part orders the transcript: whatever text preceded it was
        // said before the call, and must be stored before it.
        await flushAll();
        await persist(part);
      }
    }
    await flushAll();
    interrupted = signal.aborted;
  } catch (error) {
    if (signal.aborted) {
      interrupted = true;
    } else {
      failed = true;
      failure = error instanceof Error ? error.message : String(error);
    }
    // Best-effort: what arrived before the failure is still worth keeping.
    try {
      await flushAll();
    } catch {
      // The transcript write itself is what failed; the status below records it.
    }
  }

  const status: TurnStatus = failed
    ? 'error'
    : interrupted
      ? 'interrupted'
      : 'complete';
  await deps.messages.finishAssistantMessage(ctx.messageId, status, text);
  await deps.messages.endStream(ctx.streamId, status, failure);
  return { status, text, error: failure };
}
