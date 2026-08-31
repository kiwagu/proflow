import type { IChatListReader } from '@workspace/domain';
import type { AppDb } from '../db/db.js';
import { watchQuery } from '../live/watch.js';
import { type ChatRow, toChatMeta } from './chat.mapper.js';

export function createPgliteChatListReader(db: AppDb): IChatListReader {
  return {
    watchRecent(cb) {
      return watchQuery<ChatRow>(
        db,
        `select id, name, model, created_at, updated_at
         from chat
         where deleted_at is null
         order by updated_at desc
         limit 200`,
        [],
        (rows) => cb(rows.map(toChatMeta))
      );
    },
  };
}
