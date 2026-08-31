import { type IChatRepository, newId } from '@workspace/domain';
import { err, ok } from 'neverthrow';
import type { AppDb } from '../db/db.js';
import { type ChatRow, toChatMeta } from './chat.mapper.js';

const CHAT_COLUMNS = 'id, name, model, created_at, updated_at';

export function createPgliteChatRepository(db: AppDb): IChatRepository {
  return {
    async create(name, id) {
      try {
        const { rows } = await db.query<ChatRow>(
          `insert into chat (id, name) values ($1, $2)
           returning ${CHAT_COLUMNS}`,
          [id ?? newId('chat'), name ?? '']
        );
        const row = rows[0];
        if (!row) return err('insert returned no row');
        return ok(toChatMeta(row));
      } catch (e) {
        return err(`chat.create failed: ${String(e)}`);
      }
    },

    async get(id) {
      try {
        const { rows } = await db.query<ChatRow>(
          `select ${CHAT_COLUMNS} from chat where id = $1 and deleted_at is null`,
          [id]
        );
        const row = rows[0];
        if (!row) return err(`chat ${id} not found`);
        return ok(toChatMeta(row));
      } catch (e) {
        return err(`chat.get failed: ${String(e)}`);
      }
    },

    async rename(id, name) {
      try {
        await db.query(
          'update chat set name = $2, updated_at = now() where id = $1',
          [id, name]
        );
        return ok(undefined);
      } catch (e) {
        return err(`chat.rename failed: ${String(e)}`);
      }
    },

    async setModel(id, model) {
      try {
        await db.query(
          'update chat set model = $2, updated_at = now() where id = $1',
          [id, model]
        );
        return ok(undefined);
      } catch (e) {
        return err(`chat.setModel failed: ${String(e)}`);
      }
    },

    async softDelete(id) {
      try {
        await db.query('update chat set deleted_at = now() where id = $1', [
          id,
        ]);
        return ok(undefined);
      } catch (e) {
        return err(`chat.softDelete failed: ${String(e)}`);
      }
    },
  };
}
