/**
 * @file In-memory doubles for the chat ports.
 *
 * The subject of these specs is the session's behaviour — ordering, the
 * live turn, stopping, resuming — not storage. The doubles keep the same
 * observable contract as the real repositories (ordered parts, statuses
 * that settle, open streams that survive a "closed tab") so a spec that
 * passes here is asserting the protocol, not the fake.
 */
import type {
  ChatMessage,
  ChatMeta,
  IChatListReader,
  IChatMessageRepository,
  IChatRepository,
  ILlmGateway,
  LlmChunk,
  StoredMessagePart,
} from '@workspace/domain';
import { err, ok, type Result } from 'neverthrow';

export function fakeChats(): IChatRepository & IChatListReader {
  const rows: ChatMeta[] = [];
  let n = 0;
  return {
    async create(name) {
      const meta: ChatMeta = {
        id: `chat-${++n}`,
        name: name ?? 'New chat',
        model: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      rows.unshift(meta);
      return ok(meta);
    },
    async get(id) {
      const found = rows.find((row) => row.id === id);
      return found ? ok(found) : err('no such chat');
    },
    async rename(id, name) {
      const found = rows.find((row) => row.id === id);
      if (!found) return err('no such chat');
      found.name = name;
      return ok(undefined);
    },
    async setModel(id, model) {
      const found = rows.find((row) => row.id === id);
      if (!found) return err('no such chat');
      found.model = model;
      return ok(undefined);
    },
    async softDelete(id) {
      const at = rows.findIndex((row) => row.id === id);
      if (at !== -1) rows.splice(at, 1);
      return ok(undefined);
    },
    watchRecent(cb) {
      cb([...rows]);
      return () => {};
    },
  };
}

export interface FakeMessages extends IChatMessageRepository {
  /** Rows as stored, for a spec that asserts on the transcript directly. */
  rows: ChatMessage[];
  /** Streams still marked running — what a closed tab leaves behind. */
  streams: Map<string, { messageId: string; status: string }>;
}

export function fakeMessages(): FakeMessages {
  const rows: ChatMessage[] = [];
  const streams = new Map<string, { messageId: string; status: string }>();
  let seq = 0;
  const find = (id: string) => rows.find((row) => row.id === id);

  return {
    rows,
    streams,
    async appendUserMessage({ id, chatId, text }) {
      const row: ChatMessage = {
        id,
        chatId,
        role: 'user',
        seq: ++seq,
        text,
        model: null,
        status: 'complete',
        createdAt: new Date(),
        parts: [],
      };
      rows.push(row);
      return ok(row);
    },
    async beginAssistantMessage({ id, chatId, model }) {
      rows.push({
        id,
        chatId,
        role: 'assistant',
        seq: ++seq,
        text: '',
        model,
        status: 'streaming',
        createdAt: new Date(),
        parts: [],
      });
      return ok(undefined);
    },
    async appendPart({ messageId, part }) {
      const row = find(messageId);
      if (!row) return err('no such message');
      row.parts.push(part as StoredMessagePart);
      return ok(undefined);
    },
    async finishAssistantMessage(messageId, status, text) {
      const row = find(messageId);
      if (!row) return err('no such message');
      row.status = status;
      if (text !== undefined) row.text = text;
      return ok(undefined);
    },
    async beginStream({ id, messageId }) {
      streams.set(id, { messageId, status: 'running' });
      return ok(undefined);
    },
    async endStream(id, status) {
      const stream = streams.get(id);
      if (stream) stream.status = status;
      return ok(undefined);
    },
    async listOpenStreams() {
      return ok(
        [...streams.entries()]
          .filter(([, stream]) => stream.status === 'running')
          .map(([id, stream]) => ({ id, messageId: stream.messageId }))
      );
    },
    async listByChat(chatId) {
      return ok(
        rows
          .filter((row) => row.chatId === chatId)
          .sort((a, b) => a.seq - b.seq)
          .map((row) => ({ ...row, parts: [...row.parts] }))
      ) as Result<ChatMessage[], string>;
    },
  };
}

/**
 * A gateway that yields a scripted chunk sequence, one chunk per await, and
 * respects the abort signal between them — which is what makes a stop
 * observable in a spec without any timing.
 */
export function scriptedGateway(
  chunks: LlmChunk[],
  hooks?: { onChunk?: (index: number) => void | Promise<void> }
): ILlmGateway {
  return {
    streamChat(request) {
      return {
        async *[Symbol.asyncIterator]() {
          for (const [index, chunk] of chunks.entries()) {
            if (request.signal?.aborted) return;
            await hooks?.onChunk?.(index);
            if (request.signal?.aborted) return;
            yield chunk;
          }
        },
      };
    },
  };
}

/** Sequential ids, so a spec can name the message it expects. */
export function stableIds(): (kind: 'chatMessage' | 'stream') => string {
  const counters = new Map<string, number>();
  return (kind) => {
    const next = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, next);
    return `${kind}-${next}`;
  };
}
