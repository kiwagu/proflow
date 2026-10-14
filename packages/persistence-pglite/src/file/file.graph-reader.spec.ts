import { afterAll, beforeAll, expect, it, vi } from 'vitest';
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
  toGraphFileNodes,
  type GraphFileRow,
} from './file.graph-reader.js';

let db: Awaited<ReturnType<typeof openTestDb>>;
beforeAll(async () => {
  db = await openTestDb();
}, 30_000);
afterAll(async () => {
  await db?.close();
});

it('maps every file kind explicitly and leaves a kind the tree does not show unmapped', () => {
  expect(
    ['folder', 'text', 'file', 'link', 'video'].map(graphFileKind)
  ).toEqual(['folder', 'document', 'blob', 'blob', 'blob']);
  // A tag is graph vocabulary the file tree has no row for; a kind the
  // server may add later is the same case. Neither is an error.
  expect(graphFileKind('tag')).toBeNull();
  expect(graphFileKind('x-future')).toBeNull();
});

it('skips a row whose kind the tree does not show, warning once per kind, instead of failing the whole tree', () => {
  const row = (kind: string, id: string): GraphFileRow => ({
    id,
    parent_id: null,
    kind,
    name: id,
    mime: null,
    size: null,
    blob_hash: null,
    document_id: null,
    starred: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  });
  const skipped = vi.fn();
  const nodes = toGraphFileNodes(
    [
      row('tag', 't1'),
      row('folder', 'f1'),
      row('tag', 't2'),
      row('x-future', 'x1'),
    ],
    skipped
  );
  expect(nodes.map((node) => node.id)).toEqual(['f1']);
  expect(skipped.mock.calls).toEqual([['tag'], ['x-future']]);
});

it('leaves tags and unknown kinds out of the live tree at the query, so a seeded space still opens', async () => {
  const spaceId = testId('spc');
  const graph = createPgliteGraphRepository(db);
  const create = async (
    kind: string,
    title: string,
    parentId: string | null = null
  ) =>
    (
      await graph.createNode({
        spaceId,
        kind,
        title,
        parentId,
        createdBy: TEST_USER,
      })
    )._unsafeUnwrap().id;
  const folder = await create('folder', 'Folder');
  const text = await create('text', 'Doc', folder);
  const file = await create('file', 'File');
  await create('tag', 'Topic');
  await create('x-future', 'Later');
  const skipped = vi.fn();
  let rows: FileNode[] = [];
  const stop = createGraphFileTreeReader(db, spaceId, TEST_USER, {
    onSkippedKind: skipped,
  }).watchAll((value) => {
    rows = value;
  });
  try {
    await expect.poll(() => rows.length).toBe(3);
    expect(rows.map((r) => r.id).sort()).toEqual([folder, file, text].sort());
    // Filtered at the source: the mapper never even sees them.
    expect(skipped).not.toHaveBeenCalled();
  } finally {
    stop();
    await db.query('select 1');
  }
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

it('says who owns each row and who placed it, the columns the write scope asks about', async () => {
  const spaceId = testId('spc');
  const graph = createPgliteGraphRepository(db);
  const folder = (
    await graph.createNode({
      spaceId,
      kind: 'folder',
      title: 'Placed by the other user',
      createdBy: OTHER_USER,
      parentId: null,
    })
  )._unsafeUnwrap().id;
  const inside = (
    await graph.createNode({
      spaceId,
      kind: 'text',
      title: 'Mine, filed by the other user',
      createdBy: TEST_USER,
      parentId: null,
    })
  )._unsafeUnwrap().id;
  // The edge is the other user's: they filed my node into their folder.
  (
    await graph.moveNode(
      { spaceId, nodeId: inside, targetParentId: folder, position: 0 },
      OTHER_USER
    )
  )._unsafeUnwrap();

  let rows: FileNode[] = [];
  const stop = createGraphFileTreeReader(db, spaceId, TEST_USER).watchAll(
    (value) => {
      rows = value;
    }
  );
  try {
    await expect.poll(() => rows.length).toBe(2);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(folder)).toMatchObject({
      ownerUserId: OTHER_USER,
      parentEdgeCreatedBy: null,
    });
    expect(byId.get(inside)).toMatchObject({
      ownerUserId: TEST_USER,
      parentEdgeCreatedBy: OTHER_USER,
    });
  } finally {
    stop();
    await db.query('select 1');
  }
});
