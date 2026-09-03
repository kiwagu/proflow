import {
  type ChatMessage,
  type ChatRole,
  type IChatMessageRepository,
  type MessageStatus,
  newId,
  type StoredMessagePart,
} from '@workspace/domain';
import { err, ok } from 'neverthrow';
import type { AppDb } from '../db/db.js';

interface MessageRow {
  id: string;
  chat_id: string;
  role: string;
  seq: number;
  text: string;
  model: string | null;
  status: string;
  created_at: string | Date;
}

interface PartRow {
  message_id: string;
  idx: number;
  type: string;
  data: Record<string, unknown>;
}

function toMessage(row: MessageRow, parts: StoredMessagePart[]): ChatMessage {
  return {
    id: row.id,
    chatId: row.chat_id,
    role: row.role as ChatRole,
    seq: row.seq,
    text: row.text,
    model: row.model,
    status: row.status as MessageStatus,
    createdAt: new Date(row.created_at),
    parts,
  };
}

export function createPgliteChatMessageRepository(
  db: AppDb
): IChatMessageRepository {
  async function insertMessage(input: {
    id: string;
    chatId: string;
    role: ChatRole;
    text: string;
    model?: string;
    status: MessageStatus;
  }): Promise<MessageRow> {
    const { rows } = await db.query<MessageRow>(
      `insert into chat_message (id, chat_id, role, seq, text, model, status)
       values (
         $1, $2, $3,
         coalesce((select max(seq) from chat_message where chat_id = $2), 0) + 1,
         $4, $5, $6
       )
       returning id, chat_id, role, seq, text, model, status, created_at`,
      [
        input.id,
        input.chatId,
        input.role,
        input.text,
        input.model ?? null,
        input.status,
      ]
    );
    const row = rows[0];
    if (!row) throw new Error('insert returned no row');
    return row;
  }

  return {
    async appendUserMessage({ id, chatId, text }) {
      try {
        const row = await insertMessage({
          id,
          chatId,
          role: 'user',
          text,
          status: 'complete',
        });
        await db.query('update chat set updated_at = now() where id = $1', [
          chatId,
        ]);
        return ok(toMessage(row, []));
      } catch (e) {
        return err(`chat-message.appendUserMessage failed: ${String(e)}`);
      }
    },

    async beginAssistantMessage({ id, chatId, model }) {
      try {
        await insertMessage({
          id,
          chatId,
          role: 'assistant',
          text: '',
          model,
          status: 'streaming',
        });
        return ok(undefined);
      } catch (e) {
        return err(`chat-message.beginAssistantMessage failed: ${String(e)}`);
      }
    },

    async appendPart({ messageId, chatId, part }) {
      try {
        await db.query(
          `insert into chat_message_part (id, message_id, chat_id, idx, type, data)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            newId('chatMessagePart'),
            messageId,
            chatId,
            part.idx,
            part.type,
            JSON.stringify(part.data),
          ]
        );
        return ok(undefined);
      } catch (e) {
        return err(`chat-message.appendPart failed: ${String(e)}`);
      }
    },

    async finishAssistantMessage(messageId, status, text) {
      try {
        await db.query(
          `update chat_message
           set status = $2, text = coalesce($3, text)
           where id = $1`,
          [messageId, status, text ?? null]
        );
        return ok(undefined);
      } catch (e) {
        return err(`chat-message.finishAssistantMessage failed: ${String(e)}`);
      }
    },

    async beginStream({ id, chatId, messageId }) {
      try {
        await db.query(
          `insert into chat_stream (id, chat_id, message_id) values ($1, $2, $3)`,
          [id, chatId, messageId]
        );
        return ok(undefined);
      } catch (e) {
        return err(`chat-message.beginStream failed: ${String(e)}`);
      }
    },

    async endStream(id, status, error) {
      try {
        await db.query(
          `update chat_stream set status = $2, error = $3, ended_at = now()
           where id = $1`,
          [id, status, error ?? null]
        );
        return ok(undefined);
      } catch (e) {
        return err(`chat-message.endStream failed: ${String(e)}`);
      }
    },

    async listOpenStreams(chatId) {
      try {
        const { rows } = await db.query<{ id: string; message_id: string }>(
          `select id, message_id from chat_stream
           where chat_id = $1 and status = 'streaming'`,
          [chatId]
        );
        return ok(rows.map((r) => ({ id: r.id, messageId: r.message_id })));
      } catch (e) {
        return err(`chat-message.listOpenStreams failed: ${String(e)}`);
      }
    },

    async listByChat(chatId) {
      try {
        const { rows: messages } = await db.query<MessageRow>(
          `select id, chat_id, role, seq, text, model, status, created_at
           from chat_message where chat_id = $1 order by seq`,
          [chatId]
        );
        const { rows: parts } = await db.query<PartRow>(
          `select message_id, idx, type, data
           from chat_message_part where chat_id = $1 order by idx`,
          [chatId]
        );
        const byMessage = new Map<string, StoredMessagePart[]>();
        for (const part of parts) {
          const list = byMessage.get(part.message_id) ?? [];
          list.push({ idx: part.idx, type: part.type, data: part.data });
          byMessage.set(part.message_id, list);
        }
        return ok(messages.map((m) => toMessage(m, byMessage.get(m.id) ?? [])));
      } catch (e) {
        return err(`chat-message.listByChat failed: ${String(e)}`);
      }
    },
  };
}
