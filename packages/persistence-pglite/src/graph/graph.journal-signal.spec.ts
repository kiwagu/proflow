import type { IBlobStore } from '@workspace/domain';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDocumentCrdtStore } from '../document/document.crdt-store.js';
import { createPgliteDocumentRepository } from '../document/document.repository.js';
import { createGraphFileRepository } from '../file/file.graph-repository.js';
import { createPgliteGraphRepository } from './graph.repository.js';
import { openTestDb, testId, TEST_USER } from './graph.test-db.js';

/**
 * Every write that lands in the graph journal says so, once, after it is
 * committed — whichever repository it went through. The tab that wrote is
 * often not the tab that pushes: this is how the one that pushes hears of
 * it. A write that failed before its journal entry says nothing.
 */

let db: Awaited<ReturnType<typeof openTestDb>>;
beforeAll(async () => {
  db = await openTestDb();
}, 30_000);
afterAll(async () => {
  await db?.close();
});

const journalCount = async () =>
  Number(
    (
      await db.query<{ n: number }>(
        'select count(*)::int as n from graph_op_journal'
      )
    ).rows[0]?.n ?? 0
  );

describe('the graph journal signal', () => {
  it('the graph repository signals once per journaled command, after it is committed', async () => {
    const spaceId = testId('spc');
    const seen: number[] = [];
    const onJournaled = vi.fn(() => {
      void journalCount().then((n) => seen.push(n));
    });
    const repo = createPgliteGraphRepository(db, { onJournaled });
    const before = await journalCount();

    const folder = (
      await repo.createNode({
        spaceId,
        kind: 'folder',
        title: 'F',
        createdBy: TEST_USER,
      })
    )._unsafeUnwrap().id;
    const other = (
      await repo.createNode({
        spaceId,
        kind: 'folder',
        title: 'G',
        createdBy: TEST_USER,
      })
    )._unsafeUnwrap().id;
    const doc = (
      await repo.createNode({
        spaceId,
        kind: 'text',
        title: 'D',
        createdBy: TEST_USER,
        parentId: folder,
      })
    )._unsafeUnwrap().id;
    expect((await repo.renameNode(doc, 'Renamed')).isOk()).toBe(true);
    expect(
      (
        await repo.moveNode(
          { spaceId, nodeId: doc, targetParentId: other, position: 0 },
          TEST_USER
        )
      ).isOk()
    ).toBe(true);
    expect((await repo.trashNode(doc, TEST_USER)).isOk()).toBe(true);

    expect(onJournaled).toHaveBeenCalledTimes(6);
    expect(await journalCount()).toBe(before + 6);
    // Each signal came after its entry was visible to another reader.
    await vi.waitFor(() => expect(seen).toHaveLength(6));
    expect(seen.every((n) => n > before)).toBe(true);
  });

  it('says nothing for a write that failed before its journal entry', async () => {
    const onJournaled = vi.fn();
    const repo = createPgliteGraphRepository(db, { onJournaled });
    // Refused by the replica's own id CHECK, before the journal append.
    const created = await repo.createNode({
      spaceId: testId('spc'),
      id: 'invalid-id',
      kind: 'text',
      title: 'Invalid',
      createdBy: TEST_USER,
    });
    expect(created.isErr()).toBe(true);
    const renamed = await repo.renameNode(testId('knr'), 'Nobody');
    expect(renamed.isErr()).toBe(true);
    expect(onJournaled).not.toHaveBeenCalled();
  });

  it('the file repository signals for every write it journals, through its own transactions too', async () => {
    const spaceId = testId('spc');
    const onJournaled = vi.fn();
    const blobs = {
      put: vi.fn(async () => ({
        hash: 'h-' + testId('x'),
        size: 1,
        mime: 'text/plain',
      })),
    } as unknown as IBlobStore;
    const files = createGraphFileRepository(
      db,
      blobs,
      spaceId,
      TEST_USER,
      undefined,
      {
        onJournaled,
      }
    );
    const folder = (
      await files.createFolder({ name: 'Folder', parentId: null })
    )._unsafeUnwrap();
    const second = (
      await files.createFolder({ name: 'Second', parentId: null })
    )._unsafeUnwrap();
    expect(onJournaled).toHaveBeenCalledTimes(2);
    const file = (
      await files.importFile({
        name: 'a.txt',
        parentId: folder.id,
        blob: new Blob(['a']),
      })
    )._unsafeUnwrap();
    expect(onJournaled).toHaveBeenCalledTimes(3);
    expect((await files.rename(file.id, 'b.txt')).isOk()).toBe(true);
    expect((await files.move(file.id, second.id)).isOk()).toBe(true);
    expect((await files.setStarred(file.id, true)).isOk()).toBe(true);
    expect((await files.softDelete(file.id)).isOk()).toBe(true);
    expect(onJournaled).toHaveBeenCalledTimes(7);

    // Refused before anything was journaled: a move into itself.
    expect((await files.move(folder.id, folder.id)).isErr()).toBe(true);
    expect(onJournaled).toHaveBeenCalledTimes(7);
  });

  it('the document repository signals once for a new document and its node', async () => {
    const onJournaled = vi.fn();
    const documents = createPgliteDocumentRepository(
      db,
      createDocumentCrdtStore(db),
      testId('spc'),
      TEST_USER,
      undefined,
      { onJournaled }
    );
    expect((await documents.create({ title: 'Doc' })).isOk()).toBe(true);
    expect(onJournaled).toHaveBeenCalledTimes(1);
  });
});
