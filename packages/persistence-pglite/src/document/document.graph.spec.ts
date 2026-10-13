import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, testId, TEST_USER } from '../graph/graph.test-db.js';
import { createPgliteDocumentRepository } from './document.repository.js';
import { createDocumentCrdtStore } from './document.crdt-store.js';
import { createPgliteGraphRepository } from '../graph/graph.repository.js';
import { createPgliteGraphReplicaWriter } from '../graph/graph.replica.js';
import { createGraphFileRepository } from '../file/file.graph-repository.js';
import type { IBlobStore } from '@workspace/domain';

let db: Awaited<ReturnType<typeof openTestDb>>;
const spaceId = testId('spc');
beforeAll(async () => {
  db = await openTestDb();
}, 30_000);
afterAll(async () => {
  await db?.close();
});

it('creates a document with a journaled text node and local body reference', async () => {
  const parent = (
    await createPgliteGraphRepository(db).createNode({
      spaceId,
      kind: 'folder',
      title: 'Parent',
      createdBy: TEST_USER,
    })
  )._unsafeUnwrap().id;
  const documents = createPgliteDocumentRepository(
    db,
    createDocumentCrdtStore(db),
    spaceId,
    TEST_USER
  );
  const doc = (
    await documents.create({ title: 'Draft', parentId: parent })
  )._unsafeUnwrap();
  const { rows } = await db.query<{
    id: string;
    body_ref: unknown;
    kind: string;
  }>(
    "select id, body_ref, kind from knowledge_resources where body_ref ->> 'doc_id' = $1",
    [doc.id]
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ kind: 'text', body_ref: { doc_id: doc.id } });
  const nodeId = rows[0]!.id;
  expect(
    (
      await db.query('select from_id from knowledge_edges where to_id = $1', [
        nodeId,
      ])
    ).rows
  ).toEqual([{ from_id: parent }]);
  expect(
    (await db.query('select id from file_node where id = $1', [nodeId])).rows
  ).toEqual([]);
  const journal = await db.query<{ payload: Record<string, unknown> }>(
    "select payload from graph_op_journal where op = 'create_node' and payload ->> 'id' = $1",
    [nodeId]
  );
  expect(journal.rows[0]?.payload).toMatchObject({
    kind: 'text',
    title: 'Draft',
    parentId: parent,
  });
  expect(journal.rows[0]?.payload).toMatchObject({
    body_ref: { doc_id: doc.id },
  });
  const files = createGraphFileRepository(
    db,
    {} as IBlobStore,
    spaceId,
    TEST_USER
  );
  expect((await files.rename(nodeId, 'Renamed')).isOk()).toBe(true);
  expect(
    (await db.query('select title from document where id = $1', [doc.id])).rows
  ).toEqual([{ title: 'Renamed' }]);
});

it.each([true, false])(
  'converges document reachability to the server body reference (present: %s)',
  async (present) => {
    const documents = createPgliteDocumentRepository(
      db,
      createDocumentCrdtStore(db),
      spaceId,
      TEST_USER
    );
    const doc = (
      await documents.create({ title: 'Round trip' })
    )._unsafeUnwrap();
    const { rows } = await db.query<Record<string, unknown> & { id: string }>(
      "select * from knowledge_resources where body_ref ->> 'doc_id' = $1",
      [doc.id]
    );
    const node = rows[0]!;
    await createPgliteGraphReplicaWriter(db).applyPullBatch(
      'knowledge_resources',
      [{ ...node, body_ref: present ? { doc_id: doc.id } : null }]
    );
    const files = createGraphFileRepository(
      db,
      {} as IBlobStore,
      spaceId,
      TEST_USER
    );
    expect((await files.get(node.id))._unsafeUnwrap().documentId).toBe(
      present ? doc.id : null
    );
  }
);

it('rolls back a document when its graph node is refused', async () => {
  const documents = createPgliteDocumentRepository(
    db,
    createDocumentCrdtStore(db),
    spaceId,
    TEST_USER
  );
  const id = testId('doc');
  const result = await documents.create({ id, nodeId: 'invalid' });
  expect(result.isErr()).toBe(true);
  expect(
    (await db.query('select id from document where id = $1', [id])).rows
  ).toEqual([]);
});
