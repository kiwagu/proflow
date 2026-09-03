import type { Unsubscribe } from '../shared/subscription.js';
import type { ChatMeta } from './chat.do.js';

/** Port: the reactive read side of the chat list. */
export interface IChatListReader {
  watchRecent(cb: (chats: ChatMeta[]) => void): Unsubscribe;
}
