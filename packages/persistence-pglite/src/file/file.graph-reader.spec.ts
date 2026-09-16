import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FileNode } from '@workspace/domain';
import {
  openTestDb,
  testId,
  TEST_USER,
  OTHER_USER,
} from '../graph/graph.test-db.js';
import { createPgliteGraphRepository } from '../graph/graph.repository.js';
import {
  createGraphFileTreeReader,
  graphFileKind,
} from './file.graph-reader.js';

let db: Awaited<ReturnType<typeof openTestDb>>;
beforeAll(async () => {
  db = await openTestDb();
}, 30_000);
afterAll(async () => {
  await db?.close();
});

it('maps every graph kind explicitly and rejects unknown kinds', () => {
  expect(
    ['folder', 'text', 'file', 'link', 'video'].map(graphFileKind)
  ).toEqual(['folder', 'document', 'blob', 'blob', 'blob']);
  expect(() => graphFileKind('unknown')).toThrow(/kind/);
});

it('watches the scoped graph, containment, own stars and blob metadata', async () => {
  const spaceId = testId('spc');
  const graph = createPgliteGraphRepository(db);
  const create = async (
    kind: string,
    title: string,
    parentId: string | null = null,
    space = spaceId
  ) =>
    (
      await graph.createNode({
        spaceId: space,
        kind,
        title,
        parentId,
        createdBy: TEST_USER,
      })
    )._unsafeUnwrap().id;
  const folder = await create('folder', 'Z folder');
  const text = await create('text', 'b document', folder);
  const file = await create('file', 'A file');
  const gone = await create('text', 'Deleted');
  await graph.trashNode(gone, TEST_USER);
  await create('text', 'Other space', null, testId('spc'));
  const docId = testId('doc');
  await db.query(
    'update knowledge_resources set body_ref = $2::jsonb where id = $1',
    [text, JSON.stringify({ doc_id: docId })]
  );
  await db.query(
    "insert into blob (hash, size, mime) values ('reader-hash', 7, 'text/plain')"
  );
  await db.query(
    "insert into file_node (id, blob_hash, size, mime) values ($1, 'reader-hash', 7, 'text/plain')",
    [file]
  );
  await graph.setStarred(spaceId, text, TEST_USER, true);
  await graph.setStarred(spaceId, file, OTHER_USER, true);
  let rows: FileNode[] = [];
  const stop = createGraphFileTreeReader(db, spaceId, TEST_USER).watchAll(
    (value) => {
      rows = value;
    }
  );
  try {
    await expect.poll(() => rows.length).toBe(3);
    expect(rows.map((r) => r.id)).toEqual([folder, file, text]);
    expect(rows[0]).toMatchObject({
      kind: 'folder',
      parentId: null,
      blobHash: null,
    });
    expect(rows[1]).toMatchObject({
      kind: 'blob',
      name: 'A file',
      mime: 'text/plain',
      size: 7,
      blobHash: 'reader-hash',
      starred: false,
    });
    expect(rows[2]).toMatchObject({
      kind: 'document',
      documentId: docId,
      parentId: folder,
      starred: true,
    });
    expect(rows[2]?.createdAt).toBeInstanceOf(Date);
    await graph.renameNode(text, '0 renamed');
    await expect.poll(() => rows[1]?.name).toBe('0 renamed');
  } finally {
    stop();
    await db.query('select 1');
  }
});
