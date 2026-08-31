import { newId } from '../shared/id.js';
import {
  insertRow,
  type OptimisticEntities,
  patchRow,
  project,
  removeRows,
} from '../shared/optimistic.js';
import type { ChatMeta } from './chat.do.js';
import type { IChatListReader } from './chat.reader.js';
import type { IChatRepository } from './chat.repository.js';

/** Chats, under whatever query a surface reads them with. */
export const CHAT_ENTITY = 'chat';

/** The reader's order: most recently touched first. */
export function sortChats(chats: readonly ChatMeta[]): ChatMeta[] {
  return [...chats].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
  );
}

/**
 * The same treatment for the chat list: a new conversation, a rename or a
 * deletion is shown when it is asked for, not when the live query re-runs.
 *
 * This is the second surface on the layer and it needed no new machinery —
 * only which entity its rows belong to and how that entity is ordered.
 */
export function createOptimisticChats(deps: {
  entities: OptimisticEntities;
  chats: IChatRepository;
  chatList: IChatListReader;
  onError?: (message: string) => void;
}): { chats: IChatRepository; chatList: IChatListReader } {
  const chatRows = deps.entities.source<ChatMeta>(CHAT_ENTITY, (cb) =>
    deps.chatList.watchRecent(cb)
  );

  const run = <T>(
    projections: Array<ReturnType<typeof project>>,
    command: () => Promise<import('neverthrow').Result<T, string>>
  ) =>
    deps.entities.run(projections, command).then((result) => {
      if (result.isErr()) deps.onError?.(result.error);
      return result;
    });

  const patchChat = (id: string, patch: Partial<ChatMeta>) =>
    project<ChatMeta>(CHAT_ENTITY, patchRow<ChatMeta>(id, patch, sortChats));

  return {
    chatList: { ...deps.chatList, watchRecent: chatRows.watch },
    chats: {
      ...deps.chats,

      create(name, id = newId('chat')) {
        const at = new Date();
        return run(
          [
            project<ChatMeta>(
              CHAT_ENTITY,
              insertRow<ChatMeta>(
                {
                  id,
                  name: name ?? '',
                  model: null,
                  createdAt: at,
                  updatedAt: at,
                },
                sortChats
              )
            ),
          ],
          () => deps.chats.create(name, id)
        );
      },

      rename: (id, name) =>
        run([patchChat(id, { name })], () => deps.chats.rename(id, name)),

      setModel: (id, model) =>
        run([patchChat(id, { model })], () => deps.chats.setModel(id, model)),

      softDelete: (id) =>
        run(
          [
            project<ChatMeta>(
              CHAT_ENTITY,
              removeRows<ChatMeta>(() => [id])
            ),
          ],
          () => deps.chats.softDelete(id)
        ),
    },
  };
}
