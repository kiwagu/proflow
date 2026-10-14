import { afterAll, beforeAll, expect, it } from 'vitest';
import type { IBlobStore } from '@workspace/domain';
import { openTestDb, testId, TEST_USER } from '../graph/graph.test-db.js';
import { createGraphFileRepository } from './file.graph-repository.js';

let db: Awaited<ReturnType<typeof openTestDb>>;
const spaceId = testId('spc');
const bytes = new Blob(['hello'], { type: 'text/plain' });
const blobs: IBlobStore = {
  put: async () => ({
    hash: 'import-hash',
    size: bytes.size,
    mime: bytes.type,
  }),
  get: async () => bytes,
  has: async () => true,
  delete: async () => {},
  list: async () => [],
  clear: async () => {},
};
beforeAll(async () => {
  db = await openTestDb();
}, 30_000);
afterAll(async () => {
  await db?.close();
});
const repo = () => createGraphFileRepository(db, blobs, spaceId, TEST_USER);

it('creates folders, journals rename and move, and reads durable graph state', async () => {
  const files = repo();
  const parent = (
    await files.createFolder({ name: 'Parent', parentId: null })
  )._unsafeUnwrap();
  const child = (
    await files.createFolder({ name: 'Child', parentId: null })
  )._unsafeUnwrap();
  const before = (await db.query('select * from graph_op_journal')).rows.length;
  expect((await files.rename(child.id, 'Renamed')).isOk()).toBe(true);
  expect((await files.move(child.id, parent.id)).isOk()).toBe(true);
  expect((await db.query('select * from graph_op_journal')).rows.length).toBe(
    before + 2
  );
  expect((await repo().get(child.id))._unsafeUnwrap()).toMatchObject({
    name: 'Renamed',
    parentId: parent.id,
    kind: 'folder',
  });
  expect((await files.setStarred(child.id, true)).isOk()).toBe(true);
  expect((await files.get(child.id))._unsafeUnwrap().starred).toBe(true);
  expect((await files.softDelete(child.id)).isOk()).toBe(true);
  expect((await files.get(child.id)).isErr()).toBe(true);
});

it('rejects a move into a descendant without modifying containment or journal', async () => {
  const files = repo();
  const parent = (
    await files.createFolder({ name: 'Root', parentId: null })
  )._unsafeUnwrap();
  const child = (
    await files.createFolder({ name: 'Leaf', parentId: parent.id })
  )._unsafeUnwrap();
  const before = (await db.query('select * from graph_op_journal')).rows.length;
  expect((await files.move(parent.id, child.id)).isErr()).toBe(true);
  expect((await files.get(parent.id))._unsafeUnwrap().parentId).toBeNull();
  expect((await db.query('select * from graph_op_journal')).rows.length).toBe(
    before
  );
});

it('imports bytes and graph node under one id even inside a graph-only folder', async () => {
  const files = repo();
  const parent = (
    await files.createFolder({ name: 'Imports', parentId: null })
  )._unsafeUnwrap();
  const file = (
    await files.importFile({
      name: 'hello.txt',
      parentId: parent.id,
      blob: bytes,
    })
  )._unsafeUnwrap();
  expect(file).toMatchObject({
    parentId: parent.id,
    blobHash: 'import-hash',
    size: 5,
    mime: 'text/plain',
    kind: 'blob',
  });
  expect((await files.findByBlob('import-hash'))._unsafeUnwrap()?.id).toBe(
    file.id
  );
  expect(await (await blobs.get(file.blobHash!))?.text()).toBe('hello');
  expect(
    (await db.query('select id from file_node where id = $1', [file.id])).rows
  ).toEqual([{ id: file.id }]);
});

it('rolls back blob metadata when the graph journal refuses the import', async () => {
  const id = testId('knr');
  await db.exec(
    "alter table graph_op_journal add constraint refuse_import check (op <> 'create_node') not valid"
  );
  try {
    expect(
      (
        await repo().importFile({
          id,
          name: 'refused',
          parentId: null,
          blob: bytes,
        })
      ).isErr()
    ).toBe(true);
    expect(
      (await db.query('select id from file_node where id = $1', [id])).rows
    ).toEqual([]);
    expect(
      (await db.query('select id from knowledge_resources where id = $1', [id]))
        .rows
    ).toEqual([]);
  } finally {
    await db.exec('alter table graph_op_journal drop constraint refuse_import');
  }
});
