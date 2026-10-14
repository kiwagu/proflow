import { randomUUID } from 'node:crypto';
import { DocumentCrdt, type SerializedTree } from '@workspace/doc-crdt';
import { markdownToState } from '@workspace/lexical-nodes/utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openTestDb, testId, TEST_USER } from '../graph/graph.test-db.js';
import { createPgliteGraphSyncLedger } from '../graph/graph.sync-ledger.js';
import { createDocumentCrdtStore } from './document.crdt-store.js';
import {
  listAwaitingDocuments,
  listUnpushedDocuments,
  materializeDocuments,
  nodeAwaitsServer,
  nodeOwnerOfDocument,
  resourceIdForDocument,
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
  /** Whose node it is; the device's own user unless somebody else's is given. */
  createdBy?: string;
}): Promise<string> {
  const id = testId('knr');
  await db.query(
    `insert into knowledge_resources (id, space_id, kind, title, created_by, body_ref, deleted_at)
     values ($1, $2, 'text', $3, $4, $5::jsonb, $6)`,
    [
      id,
      input.space ?? spaceId,
      input.title,
      input.createdBy ?? TEST_USER,
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

describe('the resource that owns a document', () => {
  const repository = () =>
    createPgliteDocumentRepository(
      db,
      createDocumentCrdtStore(db),
      spaceId,
      TEST_USER
    );

  it('is the node the document was created with, kept with the document', async () => {
    const nodeId = testId('knr');
    const made = (
      await repository().create({ title: 'Owned', nodeId })
    )._unsafeUnwrap();

    // The server fences a body through the resource that owns it, and the
    // device that creates the document names that resource once, when it
    // first registers the document. The pair is written in one transaction
    // at creation, so it is the creation's own fact, not a lookup.
    expect(await resourceIdForDocument(db, made.id, TEST_USER)).toBe(nodeId);
    expect(
      await resourceIdForDocument(db, testId('doc'), TEST_USER)
    ).toBeNull();
  });

  it("is not chosen among other people's claims: an earlier node of someone else that points at the document changes nothing", async () => {
    const docId = testId('doc');
    const nodeId = testId('knr');
    const forged = testId('knr');
    // Somebody who knows the document id inserts a shared node of their own
    // pointing at it, stamped earlier than anything here, and it reaches
    // this device before the document is first registered.
    await db.query(
      `insert into knowledge_resources
         (id, space_id, kind, title, created_by, visibility, body_ref, created_at)
       values ($1, $2, 'text', 'Claim', $3, 'space', $4::jsonb, now() - interval '1 day')`,
      [
        forged,
        spaceId,
        // An auth user id, not an entity id: someone else.
        randomUUID(),
        JSON.stringify({ doc_id: docId }),
      ]
    );

    await repository().create({ id: docId, nodeId, title: 'Mine' });

    expect(await resourceIdForDocument(db, docId, TEST_USER)).toBe(nodeId);
  });

  it("is the node its own creator made, for a document the graph brought in to the creator's second device", async () => {
    const docId = testId('doc');
    const nodeId = await pulledTextNode({ docId, title: 'Mine, elsewhere' });
    await materializeDocuments(db, spaceId);

    // The same person on another device: the node arrives alone, and if the
    // body is first registered from here the owner must still be named, or
    // the body would stay the creator's alone for good.
    expect(await resourceIdForDocument(db, docId, TEST_USER)).toBe(nodeId);
  });

  it('is asked for when the body is registered, not when the document row is made: a node that arrives later still counts', async () => {
    const docId = testId('doc');
    // Somebody else's node reaches this device first, and the graph pull is
    // interrupted before the creator's own node arrives.
    await pulledTextNode({ docId, title: 'Claim', createdBy: randomUUID() });
    await materializeDocuments(db, spaceId);
    expect(await resourceIdForDocument(db, docId, TEST_USER)).toBeNull();

    const mine = await pulledTextNode({ docId, title: 'Mine' });
    await materializeDocuments(db, spaceId);

    // The row was made while the creator's node was missing; the answer is
    // given from what the device holds now, at the moment it is needed.
    expect(await resourceIdForDocument(db, docId, TEST_USER)).toBe(mine);
  });

  it("ignores other people's claims on the document, however early or visible", async () => {
    const docId = testId('doc');
    const mine = await pulledTextNode({ docId, title: 'Mine' });
    await db.query(
      `insert into knowledge_resources
         (id, space_id, kind, title, created_by, visibility, body_ref, created_at)
       values ($1, $2, 'text', 'Claim', $3, 'space', $4::jsonb, now() - interval '1 day')`,
      [testId('knr'), spaceId, randomUUID(), JSON.stringify({ doc_id: docId })]
    );
    await materializeDocuments(db, spaceId);

    expect(await resourceIdForDocument(db, docId, TEST_USER)).toBe(mine);
  });

  it("is nothing when only somebody else's node points at the document", async () => {
    const docId = testId('doc');
    await pulledTextNode({ docId, title: 'Theirs', createdBy: randomUUID() });
    await materializeDocuments(db, spaceId);

    expect(await resourceIdForDocument(db, docId, TEST_USER)).toBeNull();
  });

  it("is nothing when two of the creator's own nodes point at the document: which is the owner is not for a guess", async () => {
    const docId = testId('doc');
    await pulledTextNode({ docId, title: 'Mine' });
    await pulledTextNode({ docId, title: 'Mine too' });
    await materializeDocuments(db, spaceId);

    expect(await resourceIdForDocument(db, docId, TEST_USER)).toBeNull();
  });
});

describe('the owner of the node a document belongs to', () => {
  const ownedBy = async (nodeId: string, owner: string) =>
    db.query(
      'update knowledge_resources set owner_user_id = $2 where id = $1',
      [nodeId, owner]
    );

  it('is the owner of the one live node that points at the document', async () => {
    const docId = testId('doc');
    const owner = randomUUID();
    await ownedBy(await pulledTextNode({ docId, title: 'Owned' }), owner);
    expect(await nodeOwnerOfDocument(db, docId)).toBe(owner);
  });

  it('is nobody when no node points at it, when its only node is trashed, or when two do', async () => {
    expect(await nodeOwnerOfDocument(db, testId('doc'))).toBeNull();

    const trashedDoc = testId('doc');
    await ownedBy(
      await pulledTextNode({ docId: trashedDoc, title: 'Gone', trashed: true }),
      randomUUID()
    );
    expect(await nodeOwnerOfDocument(db, trashedDoc)).toBeNull();

    const twice = testId('doc');
    await ownedBy(
      await pulledTextNode({ docId: twice, title: 'One' }),
      randomUUID()
    );
    await ownedBy(
      await pulledTextNode({ docId: twice, title: 'Two' }),
      randomUUID()
    );
    expect(await nodeOwnerOfDocument(db, twice)).toBeNull();
  });
});

describe('a node the server has not accepted yet', () => {
  it('is waiting while its creation is journaled, and not once the server took it', async () => {
    const nodeId = testId('knr');
    await createPgliteDocumentRepository(
      db,
      createDocumentCrdtStore(db),
      spaceId,
      TEST_USER
    ).create({ title: 'Just made', nodeId });

    // The server takes a body's name only from someone it can check, and it
    // checks the node on the server: until the node's creation has gone
    // through, a body naming it would be refused.
    expect(await nodeAwaitsServer(db, nodeId)).toBe(true);

    const ledger = createPgliteGraphSyncLedger(db);
    for (const op of await ledger.pendingOps(spaceId))
      if (op.nodeIds.some((id) => id === nodeId)) await ledger.ackOp(op.id);
    expect(await nodeAwaitsServer(db, nodeId)).toBe(false);
  });

  it('is not waiting for a node it knows only from the server, nor for one with other changes journaled', async () => {
    const pulled = await pulledTextNode({
      docId: testId('doc'),
      title: 'From the server',
    });
    expect(await nodeAwaitsServer(db, pulled)).toBe(false);

    await db.query(
      `insert into graph_op_journal (space_id, op, payload, node_ids)
       values ($1, 'rename_node', '{}'::jsonb, $2)`,
      [spaceId, [pulled]]
    );
    expect(await nodeAwaitsServer(db, pulled)).toBe(false);
  });
});

describe('the end of the wait for a first pull', () => {
  it('is told to everyone listening, by document id, and stops when they stop', () => {
    const store = createDocumentCrdtStore(db);
    const heard: string[] = [];
    const stop = store.onSettled((id) => heard.push(id));

    // A pull that finds nothing merges nothing, so no change is announced:
    // this is how a surface showing the wait learns it is over.
    store.settled('doc-a');
    store.settled('doc-b');
    stop();
    store.settled('doc-c');

    expect(heard).toEqual(['doc-a', 'doc-b']);
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

  it('lists a document written before versions were kept until it is opened and found pushed', async () => {
    const store = createDocumentCrdtStore(db);
    const documents = createPgliteDocumentRepository(
      db,
      store,
      spaceId,
      TEST_USER
    );
    const id = (await documents.create({ title: 'Legacy' }))._unsafeUnwrap().id;
    await store.save({
      id,
      tree: treeOf('kept'),
      markdown: 'kept',
      preview: 'kept',
      author: AUTHOR,
    });
    // As a database from before version tracking holds it: an edit on
    // disk, a ledger row, and no version beside the row.
    await db.query('update document set version_vv = null where id = $1', [id]);
    await db.query(
      `insert into document_sync (document_id, pushed_vv) values ($1, $2)
       on conflict (document_id) do update set pushed_vv = excluded.pushed_vv`,
      [id, DocumentCrdt.create().versionBytes()]
    );
    expect(await listUnpushedDocuments(db)).toContain(id);

    // Opening it records its version; pushed, it leaves the list for good.
    const reopened = createDocumentCrdtStore(db);
    const version = (await reopened.syncable(id))!.versionBytes();
    await db.query(
      'update document_sync set pushed_vv = $2 where document_id = $1',
      [id, version]
    );
    expect(await listUnpushedDocuments(db)).not.toContain(id);
  });

  it('leaves out a document only known from the graph', async () => {
    const docId = testId('doc');
    await pulledTextNode({ docId, title: 'Known' });
    await materializeDocuments(db, spaceId);
    expect(await listUnpushedDocuments(db)).not.toContain(docId);
  });
});
