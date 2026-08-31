import { LOCAL_USER_ID } from '@workspace/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  createInMemoryChatStore,
  createInMemoryDocumentStore,
} from './index.js';

describe('in-memory document store', () => {
  it('create → watch fires with the new document, delete hides it', async () => {
    const { repository, reader } = createInMemoryDocumentStore();
    const seen: string[][] = [];
    const unsubscribe = reader.watchRecent((docs) =>
      seen.push(docs.map((d) => d.id))
    );

    expect(seen).toEqual([[]]);

    const created = (await repository.create({ title: 'a' }))._unsafeUnwrap();
    expect(seen.at(-1)).toEqual([created.id]);

    (await repository.rename(created.id, 'renamed'))._unsafeUnwrap();
    const loaded = (await repository.load(created.id))._unsafeUnwrap();
    expect(loaded.meta.title).toBe('renamed');
    expect(loaded.content).toBeNull();

    const tree = { root: { type: 'root', children: [] } };
    const changed = (
      await repository.save({
        id: created.id,
        tree,
        markdown: '# hi',
        preview: 'hi',
        author: { user: LOCAL_USER_ID, src: 'human' },
      })
    )._unsafeUnwrap();
    expect(changed).toBe(true);
    const reloaded = (await repository.load(created.id))._unsafeUnwrap();
    expect(reloaded.content?.markdown).toBe('# hi');

    // Saving the same tree again is not a change, and must not read as one.
    const again = (
      await repository.save({
        id: created.id,
        tree,
        markdown: '# hi',
        preview: 'hi',
        author: { user: LOCAL_USER_ID, src: 'human' },
      })
    )._unsafeUnwrap();
    expect(again).toBe(false);

    (await repository.softDelete(created.id))._unsafeUnwrap();
    expect(seen.at(-1)).toEqual([]);

    unsubscribe();
    const callsAfter = seen.length;
    await repository.create({});
    expect(seen.length).toBe(callsAfter);
  });

  it('load of a missing document is an err, not a throw', async () => {
    const { repository } = createInMemoryDocumentStore();
    const result = await repository.load('nope');
    expect(result.isErr()).toBe(true);
  });
});

describe('in-memory chat store', () => {
  it('streaming transcript: begin → parts → finish, seq is monotonic', async () => {
    const { repository, messages } = createInMemoryChatStore();
    const chat = (await repository.create('test'))._unsafeUnwrap();

    (
      await messages.appendUserMessage({
        id: 'u1',
        chatId: chat.id,
        text: 'hello',
      })
    )._unsafeUnwrap();
    (
      await messages.beginAssistantMessage({
        id: 'a1',
        chatId: chat.id,
        model: 'mock',
      })
    )._unsafeUnwrap();
    (
      await messages.appendPart({
        messageId: 'a1',
        chatId: chat.id,
        part: { idx: 0, type: 'text', data: { text: 'hi' } },
      })
    )._unsafeUnwrap();
    (
      await messages.finishAssistantMessage('a1', 'complete', 'hi')
    )._unsafeUnwrap();

    const transcript = (await messages.listByChat(chat.id))._unsafeUnwrap();
    expect(transcript.map((m) => [m.role, m.seq])).toEqual([
      ['user', 1],
      ['assistant', 2],
    ]);
    expect(transcript[1]?.parts).toEqual([
      { idx: 0, type: 'text', data: { text: 'hi' } },
    ]);
    expect(transcript[1]?.status).toBe('complete');
  });

  it('an interrupted turn stays representable', async () => {
    const { repository, messages } = createInMemoryChatStore();
    const chat = (await repository.create())._unsafeUnwrap();
    (
      await messages.beginAssistantMessage({
        id: 'a1',
        chatId: chat.id,
        model: 'mock',
      })
    )._unsafeUnwrap();
    (await messages.finishAssistantMessage('a1', 'error'))._unsafeUnwrap();
    const transcript = (await messages.listByChat(chat.id))._unsafeUnwrap();
    expect(transcript[0]?.status).toBe('error');
  });

  it('watch reflects renames without re-subscribing', async () => {
    const { repository, reader } = createInMemoryChatStore();
    const cb = vi.fn();
    reader.watchRecent(cb);
    const chat = (await repository.create('one'))._unsafeUnwrap();
    await repository.rename(chat.id, 'two');
    const last = cb.mock.calls.at(-1)?.[0];
    expect(last[0]?.name).toBe('two');
  });
});
