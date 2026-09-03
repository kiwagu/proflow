import type {
  ChatMessage,
  ChatMeta,
  IChatListReader,
  IChatMessageRepository,
  IChatRepository,
  StoredMessagePart,
} from '@workspace/domain';
import { newId } from '@workspace/domain';
import { err, ok } from 'neverthrow';

type ChatState = ChatMeta & { deletedAt: Date | null };

export function createInMemoryChatStore(): {
  repository: IChatRepository;
  reader: IChatListReader;
  messages: IChatMessageRepository;
} {
  const chats = new Map<string, ChatState>();
  const messages = new Map<string, ChatMessage>();
  const streams = new Map<
    string,
    {
      id: string;
      chatId: string;
      messageId: string;
      status: 'streaming' | 'complete' | 'error' | 'interrupted';
      error?: string;
    }
  >();
  const subscribers = new Set<(chats: ChatMeta[]) => void>();

  function snapshot(): ChatMeta[] {
    return [...chats.values()]
      .filter((c) => c.deletedAt === null)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map(({ deletedAt: _d, ...meta }) => meta);
  }
  function notify(): void {
    const list = snapshot();
    for (const cb of subscribers) cb(list);
  }
  function nextSeq(chatId: string): number {
    let max = 0;
    for (const m of messages.values())
      if (m.chatId === chatId && m.seq > max) max = m.seq;
    return max + 1;
  }

  return {
    repository: {
      async create(name, id) {
        const meta: ChatMeta = {
          id: id ?? newId('chat'),
          name: name ?? '',
          model: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        chats.set(meta.id, { ...meta, deletedAt: null });
        notify();
        return ok(meta);
      },
      async get(id) {
        const row = chats.get(id);
        if (!row || row.deletedAt) return err(`chat ${id} not found`);
        const { deletedAt: _d, ...meta } = row;
        return ok(meta);
      },
      async rename(id, name) {
        const row = chats.get(id);
        if (!row) return err(`chat ${id} not found`);
        row.name = name;
        row.updatedAt = new Date();
        notify();
        return ok(undefined);
      },
      async setModel(id, model) {
        const row = chats.get(id);
        if (!row) return err(`chat ${id} not found`);
        row.model = model;
        notify();
        return ok(undefined);
      },
      async softDelete(id) {
        const row = chats.get(id);
        if (!row) return err(`chat ${id} not found`);
        row.deletedAt = new Date();
        notify();
        return ok(undefined);
      },
    },
    reader: {
      watchRecent(cb) {
        subscribers.add(cb);
        cb(snapshot());
        return () => subscribers.delete(cb);
      },
    },
    messages: {
      async appendUserMessage({ id, chatId, text }) {
        const message: ChatMessage = {
          id,
          chatId,
          role: 'user',
          seq: nextSeq(chatId),
          text,
          model: null,
          status: 'complete',
          createdAt: new Date(),
          parts: [],
        };
        messages.set(id, message);
        const chat = chats.get(chatId);
        if (chat) {
          chat.updatedAt = new Date();
          notify();
        }
        return ok(message);
      },
      async beginAssistantMessage({ id, chatId, model }) {
        messages.set(id, {
          id,
          chatId,
          role: 'assistant',
          seq: nextSeq(chatId),
          text: '',
          model,
          status: 'streaming',
          createdAt: new Date(),
          parts: [],
        });
        return ok(undefined);
      },
      async appendPart({ messageId, part }) {
        const message = messages.get(messageId);
        if (!message) return err(`message ${messageId} not found`);
        message.parts.push(structuredClone(part) as StoredMessagePart);
        return ok(undefined);
      },
      async finishAssistantMessage(messageId, status, text) {
        const message = messages.get(messageId);
        if (!message) return err(`message ${messageId} not found`);
        message.status = status;
        if (text !== undefined) message.text = text;
        return ok(undefined);
      },
      async beginStream({ id, chatId, messageId }) {
        streams.set(id, { id, chatId, messageId, status: 'streaming' });
        return ok(undefined);
      },
      async endStream(id, status, error) {
        const stream = streams.get(id);
        if (!stream) return err(`stream ${id} not found`);
        stream.status = status;
        stream.error = error;
        return ok(undefined);
      },
      async listOpenStreams(chatId) {
        return ok(
          [...streams.values()]
            .filter((s) => s.chatId === chatId && s.status === 'streaming')
            .map((s) => ({ id: s.id, messageId: s.messageId }))
        );
      },
      async listByChat(chatId) {
        return ok(
          [...messages.values()]
            .filter((m) => m.chatId === chatId)
            .sort((a, b) => a.seq - b.seq)
        );
      },
    },
  };
}
