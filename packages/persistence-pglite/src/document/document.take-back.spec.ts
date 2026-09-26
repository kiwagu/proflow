/**
 * Taking a created document back, on the real store.
 *
 * A document is two facts — its row and its node in the tree — and the
 * explorer lists the NODE. A flow that creates a document and then fails to
 * fill it must remove what the explorer shows, so the two soft deletes are
 * not interchangeable: this pins which one the tree reader honours, with a
 * real PGlite and the app's own migrations.
 */
import type { FileNode, IBlobStore } from '@workspace/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGraphFileTreeReader } from '../file/file.graph-reader.js';
import { createGraphFileRepository } from '../file/file.graph-repository.js';
import { openTestDb, TEST_USER, testId } from '../graph/graph.test-db.js';
import { createDocumentCrdtStore } from './document.crdt-store.js';
import { createPgliteDocumentRepository } from './document.repository.js';

describe('taking a created document back', () => {
  let db: Awaited<ReturnType<typeof openTestDb>>;

  beforeAll(async () => {
    db = await openTestDb();
  }, 30_000);

  afterAll(async () => {
    await db?.close();
  });

  it('is the node, not the document row, that the explorer stops listing', async () => {
    const spaceId = testId('spc');
    const documents = createPgliteDocumentRepository(
      db,
      createDocumentCrdtStore(db),
      spaceId,
      TEST_USER
    );
    const files = createGraphFileRepository(
      db,
      {} as unknown as IBlobStore,
      spaceId,
      TEST_USER
    );
    const reader = createGraphFileTreeReader(db, spaceId, TEST_USER);
    // One watch for the whole case, closed at the end and let settle before
    // the database goes away, the way the reader's own spec holds it.
    const id = testId('doc');
    const nodeId = testId('knr');
    let latest: FileNode[] = [];
    const stop = reader.watchAll((rows) => {
      latest = rows;
    });
    const listsNode = () => latest.some((row) => row.id === nodeId);

    const created = await documents.create({
      title: 'note',
      parentId: null,
      id,
      nodeId,
    });
    expect(created.isOk()).toBe(true);
    try {
      await expect.poll(listsNode).toBe(true);

      // The premise of the defect: the document row can be gone while the
      // explorer still shows the node — an entry that opens to nothing. The
      // tree query never touches the document table, so nothing re-delivers;
      // a settled pause then asserts what the explorer keeps showing.
      expect((await documents.softDelete(id)).isOk()).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(listsNode()).toBe(true);

      // The compensation that works: take the node back.
      expect((await files.softDelete(nodeId)).isOk()).toBe(true);
      await expect.poll(() => !listsNode()).toBe(true);
    } finally {
      stop();
      await db.query('select 1');
    }
  });
});
