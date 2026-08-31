import type { ChatMeta } from '@workspace/domain';

export interface ChatRow {
  id: string;
  name: string;
  model: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

export function toChatMeta(row: ChatRow): ChatMeta {
  return {
    id: row.id,
    name: row.name,
    model: row.model,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
