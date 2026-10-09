import { DocumentCrdt, type SerializedTree } from '@workspace/doc-crdt';
import { markdownToState } from '@workspace/lexical-nodes/utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openTestDb, testId, TEST_USER } from '../graph/graph.test-db.js';
import { createDocumentCrdtStore } from './document.crdt-store.js';
import {
  listAwaitingDocuments,
  listUnpushedDocuments,
  materializeDocuments,
} from './document.materialize.js';
import { createPgliteDocumentRepository } from './document.repository.js';

/**
 * The graph brings nodes; a text node's body lives in a document row this
 * device may not have. Against a real PGlite because what is under test is
 * one insert-select and its predicates.
 */
let db: Awaited<ReturnType<typeof openTestDb>>;
const spaceId = testId('spc');

beforeAll(async () => {
  db = await openTestDb();
}, 30_000);
afterAll(async () => {
  await db?.close();
});

async function pulledTextNode(input: {
  docId: string;
  title: string;
  trashed?: boolean;
  space?: string;
}): Promise<string> {
  const id = testId('knr');
  await db.query(
    `insert into knowledge_resources (id, space_id, kind, title, created_by, body_ref, deleted_at)
     values ($1, $2, 'text', $3, $4, $5::jsonb, $6)`,
    [
      id,
      input.space ?? spaceId,
      input.title,
      TEST_USER,
      JSON.stringify({ doc_id: input.docId }),
      input.trashed ? new Date() : null,
    ]
  );
  return id;
}

const documentRow = async (id: string) =>
  (
    await db.query<{ title: string; kind: string }>(
      'select title, kind from document where id = $1',
      [id]
    )
  ).rows[0];

const ledgerRow = async (id: string) => {
  const { rows } = await db.query<{
    pushed_vv: Uint8Array | null;
    pulled_seq: number | string;
  }>('select pushed_vv, pulled_seq from document_sync where document_id = $1', [
    id,
  ]);
  const row = rows[0];
  return row
    ? { pushedVv: row.pushed_vv, pulledSeq: Number(row.pulled_seq) }
    : undefined;
};

describe('materializing documents the graph brought in', () => {
  it('gives a live text node without a document a row: known, empty, never pulled', async () => {
    const docId = testId('doc');
    await pulledTextNode({ docId, title: 'From another device' });
    expect(await materializeDocuments(db, spaceId)).toBe(1);
    expect(await documentRow(docId)).toEqual({
      title: 'From another device',
      kind: 'md',
    });
    // Nothing of this device's own to send: the empty version is what has
    // been "pushed", so whatever the first pull brings is not sent back.
    expect(await ledgerRow(docId)).toEqual({
      pushedVv: DocumentCrdt.create().versionBytes(),
      pulledSeq: -1,
    });
  });

  it('leaves a trashed node, another space and a document made here alone', async () => {
    const trashed = testId('doc');
    await pulledTextNode({ docId: trashed, title: 'Trashed', trashed: true });
    const elsewhere = testId('doc');
    await pulledTextNode({
      docId: elsewhere,
      title: 'Elsewhere',
      space: testId('spc'),
    });
    const documents = createPgliteDocumentRepository(
      db,
      createDocumentCrdtStore(db),
      spaceId,
      TEST_USER
    );
    const own = (
      await documents.create({ title: 'Made here' })
    )._unsafeUnwrap();

    expect(await materializeDocuments(db, spaceId)).toBe(0);
    expect(await documentRow(trashed)).toBeUndefined();
    expect(await documentRow(elsewhere)).toBeUndefined();
    expect(await documentRow(own.id)).toEqual({
      title: 'Made here',
      kind: 'md',
    });
    expect(await ledgerRow(own.id)).toBeUndefined();
  });

  it('a node restored from the trash gets its row on the next run', async () => {
    const docId = testId('doc');
    const nodeId = await pulledTextNode({
      docId,
      title: 'Back',
      trashed: true,
    });
    expect(await materializeDocuments(db, spaceId)).toBe(0);
    await db.query(
      'update knowledge_resources set deleted_at = null where id = $1',
      [nodeId]
    );
    expect(await materializeDocuments(db, spaceId)).toBe(1);
    expect(await documentRow(docId)).toEqual({ title: 'Back', kind: 'md' });
  });

  it('changes nothing when run again', async () => {
    const docId = testId('doc');
    await pulledTextNode({ docId, title: 'Once' });
    await materializeDocuments(db, spaceId);
    expect(await materializeDocuments(db, spaceId)).toBe(0);
  });
});

describe('documents awaiting their first pull', () => {
  it('lists a materialized document until it holds bytes, and never one made here', async () => {
    const docId = testId('doc');
    await pulledTextNode({ docId, title: 'Waiting' });
    await materializeDocuments(db, spaceId);
    const documents = createPgliteDocumentRepository(
      db,
      createDocumentCrdtStore(db),
      spaceId,
      TEST_USER
    );
    const own = (await documents.create({ title: 'Mine' }))._unsafeUnwrap();

    const waiting = await listAwaitingDocuments(db);
    expect(waiting).toContain(docId);
    expect(waiting).not.toContain(own.id);

    await db.query(
      'insert into document_update (document_id, bytes) values ($1, $2)',
      [docId, new Uint8Array([0])]
    );
    expect(await listAwaitingDocuments(db)).not.toContain(docId);
  });
});

describe('documents with changes the server may not have', () => {
  const AUTHOR = { user: 'tester', src: 'human' as const };
  const treeOf = (markdown: string): SerializedTree =>
    markdownToState(markdown).state as unknown as SerializedTree;

  it('lists one never pushed, drops it once pushed, and lists it again after a save or a restore', async () => {
    const store = createDocumentCrdtStore(db);
    const documents = createPgliteDocumentRepository(
      db,
      store,
      spaceId,
      TEST_USER
    );
    const id = (await documents.create({ title: 'Edited' }))._unsafeUnwrap().id;
    expect(await listUnpushedDocuments(db)).toContain(id);

    await store.save({
      id,
      tree: treeOf('v1'),
      markdown: 'v1',
      preview: 'v1',
      author: AUTHOR,
    });
    const first = await store.frontiers(id);
    const markPushed = async () => {
      const version = (await store.syncable(id))!.versionBytes();
      await db.query(
        `insert into document_sync (document_id, pushed_vv) values ($1, $2)
         on conflict (document_id) do update set pushed_vv = excluded.pushed_vv`,
        [id, version]
      );
    };
    await markPushed();
    expect(await listUnpushedDocuments(db)).not.toContain(id);

    await store.save({
      id,
      tree: treeOf('v1 v2'),
      markdown: 'v1 v2',
      preview: 'v1 v2',
      author: AUTHOR,
    });
    expect(await listUnpushedDocuments(db)).toContain(id);

    await markPushed();
    expect(await listUnpushedDocuments(db)).not.toContain(id);
    await store.restore(id, first, AUTHOR);
    expect(await listUnpushedDocuments(db)).toContain(id);
  });

  it('leaves out a document only known from the graph', async () => {
    const docId = testId('doc');
    await pulledTextNode({ docId, title: 'Known' });
    await materializeDocuments(db, spaceId);
    expect(await listUnpushedDocuments(db)).not.toContain(docId);
  });
});
