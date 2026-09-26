/**
 * A failed markdown import against the REAL store.
 *
 * The importer's rollback is judged by what the readers show afterwards —
 * the tree the explorer lists and the recent list the assistant reads —
 * not by which port method was called. Fresh readers are asked too: the
 * optimistic projection of a live session can hide a discrepancy the
 * database would show to the next one.
 */
import type { IBlobStore } from '@workspace/domain';
import {
  createDocumentCrdtStore,
  createGraphFileRepository,
  createGraphFileTreeReader,
  createPgliteDocumentListReader,
  createPgliteDocumentRepository,
} from '@workspace/persistence-pglite';
import {
  openTestDatabase,
  TEST_USER_ID,
  testId,
} from '@workspace/persistence-pglite/testing';
import { err } from 'neverthrow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importMarkdownDocument } from './document-markdown';

const AUTHOR = { user: TEST_USER_ID, src: 'human' as const };

describe('a markdown import whose content cannot be written', () => {
  let db: Awaited<ReturnType<typeof openTestDatabase>>;

  beforeAll(async () => {
    db = await openTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  it('leaves nothing behind in the tree or the recent list, for this session and the next', async () => {
    const spaceId = testId('spc');
    const documents = createPgliteDocumentRepository(
      db,
      createDocumentCrdtStore(db),
      spaceId,
      TEST_USER_ID
    );
    const files = createGraphFileRepository(
      db,
      {} as unknown as IBlobStore,
      spaceId,
      TEST_USER_ID
    );
    const treeOf = () => createGraphFileTreeReader(db, spaceId, TEST_USER_ID);
    const recentOf = () => createPgliteDocumentListReader(db);
    /** One delivery from a fresh reader, closed and settled before the next question. */
    const once = async <T>(
      watch: (cb: (rows: T[]) => void) => () => void
    ): Promise<T[]> => {
      let stop: (() => void) | undefined;
      const rows = await new Promise<T[]>((resolve) => {
        stop = watch((delivered) => resolve(delivered));
      });
      stop?.();
      await db.query('select 1');
      return rows;
    };

    // Readers that were already listening when the import failed — the
    // session in which it happened — and fresh ones, the next session.
    let treeLive: string[] = [];
    let recentLive: string[] = [];
    const stopTree = treeOf().watchAll((rows) => {
      treeLive = rows.map((node) => node.name);
    });
    const stopRecent = recentOf().watchRecent((rows) => {
      recentLive = rows.map((document) => document.title);
    });
    try {
      const result = await importMarkdownDocument(
        {
          documents: { ...documents, save: async () => err('disk is full') },
          files,
        },
        AUTHOR,
        { name: 'note', text: '# Hi', parentId: null }
      );
      expect(result.isErr() && result.error).toBe('disk is full');

      // The live subscriptions settle on a tree and a list without the
      // document; a window in which they showed it is what a user of the
      // running session would have glimpsed, and is allowed to close.
      await expect.poll(() => treeLive.includes('note')).toBe(false);
      await expect.poll(() => recentLive.includes('note')).toBe(false);

      const treeNext = await once(treeOf().watchAll);
      expect(treeNext.map((node) => node.name)).not.toContain('note');
      const recentNext = await once(recentOf().watchRecent);
      expect(recentNext.map((document) => document.title)).not.toContain(
        'note'
      );
    } finally {
      stopTree();
      stopRecent();
    }
    await db.query('select 1');
  });
});
