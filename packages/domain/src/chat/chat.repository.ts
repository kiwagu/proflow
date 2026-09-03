import type { Result } from 'neverthrow';
import type { ChatMeta } from './chat.do.js';

/** Port: one-shot commands and reads on a single chat. */
export interface IChatRepository {
  create(name?: string, id?: string): Promise<Result<ChatMeta, string>>;
  get(id: string): Promise<Result<ChatMeta, string>>;
  rename(id: string, name: string): Promise<Result<void, string>>;
  setModel(id: string, model: string): Promise<Result<void, string>>;
  softDelete(id: string): Promise<Result<void, string>>;
}
