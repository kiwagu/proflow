import { describe, expect, it } from 'vitest';
import { openTestDb, TEST_USER } from './graph.test-db.js';
import { createPgliteGraphReader } from './graph.reader.js';
import {
  createPgliteGraphRepository,
  GRAPH_OPS,
} from './graph.repository.js';
import { createPgliteGraphSyncLedger } from './graph.sync-ledger.js';

/**
 * The write path's contract is that a local write and its journal entry come
 * as one unit, and that every op is idempotent — so the suite checks both the
 * replica row and the journal after each command, and replays where replay is
 * the thing being claimed.
 */
async function open() {
  const db = await openTestDb();
  const repo = createPgliteGraphRepository(db);
  const reader = createPgliteGraphReader(db);
  const ledger = createPgliteGraphSyncLedger(db);
  const spaceId = 'spc_0000000000000001.0000000000';

  const node = async (title: string, parentId?: string): Promise<string> => {
    const result = await repo.createNode({
      spaceId,
      kind: parentId ? 'text' : 'folder',
      title,
      createdBy: TEST_USER,
      parentId: parentId ?? null,
    });
    if (result.isErr()) throw new Error(result.error);
    return result.value.id;
  };

  return { db, repo, reader, ledger, spaceId, node };
}

describe('graph repository', () => {
  it('journals every structural command with the nodes it touches', async () => {
    const { db, repo, ledger, spaceId, node } = await open();
    const folder = await node('Folder');
    const doc = await node('Doc', folder);

    expect((await repo.renameNode(doc, 'Renamed')).isOk()).toBe(true);
    expect((await repo.setStatus(doc, 'active')).isOk()).toBe(true);
    expect((await repo.setStarred(spaceId, doc, TEST_USER, true)).isOk()).toBe(
      true
    );

    const ops = await ledger.pendingOps(spaceId);
    expect(ops.map((op) => op.op)).toEqual([
      GRAPH_OPS.createNode,
      GRAPH_OPS.createNode,
      GRAPH_OPS.renameNode,
      GRAPH_OPS.setStatus,
      GRAPH_OPS.setStarred,
    ]);
    // The child's create touched both the child and its container: the edge
    // is part of the same intent, so a refusal must reconcile both.
    expect(new Set(ops[1]?.nodeIds)).toEqual(new Set([doc, folder]));
    expect(ops[2]?.payload).toEqual({ id: doc, title: 'Renamed' });
    expect(await ledger.pendingCount(spaceId)).toBe(5);

    await db.close();
  });

  it('creates idempotently, so a replayed create writes no second row', async () => {
    const { db, repo, spaceId } = await open();
    const id = 'knr_0000000000000009.0000000000';
    for (const attempt of ['First', 'Replayed']) {
      const result = await repo.createNode({
        spaceId,
        id,
        kind: 'text',
        title: attempt,
        createdBy: TEST_USER,
      });
      expect(result.isOk()).toBe(true);
    }
    const { rows } = await db.query<{ count: string }>(
      'select count(*) as count from knowledge_resources where id = $1',
      [id]
    );
    // `on conflict do nothing`: the row keeps its first title, and there is
    // exactly one of it.
    expect(Number(rows[0]?.count)).toBe(1);

    await db.close();
  });

  it('upserts an edge on its natural key rather than duplicating it', async () => {
    const { db, repo, reader, spaceId, node } = await open();
    const folder = await node('Folder');
    const doc = await node('Doc');

    for (const position of [0, 3]) {
      expect(
        (
          await repo.upsertEdge({
            spaceId,
            from: folder,
            to: doc,
            relationType: 'contains',
            createdBy: TEST_USER,
            position,
          })
        ).isOk()
      ).toBe(true);
    }

    const edges = await reader.readEdges(spaceId, 'contains');
    expect(edges).toHaveLength(1);
    expect(edges[0]?.position).toBe(3);

    await db.close();
  });

  it('refuses to contain a folder inside its own subtree', async () => {
    const { db, repo, spaceId, node } = await open();
    const root = await node('Root');
    const child = await node('Child', root);

    const result = await repo.upsertEdge({
      spaceId,
      from: child,
      to: root,
      relationType: 'contains',
      createdBy: TEST_USER,
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain('own subtree');

    await db.close();
  });

  it('trashes only the node itself and leaves the cascade to the server', async () => {
    const { db, repo, reader, spaceId, node } = await open();
    const folder = await node('Folder');
    const child = await node('Child', folder);

    expect((await repo.trashNode(folder, TEST_USER)).isOk()).toBe(true);

    // The child is still live locally: the server's cascade trigger is the
    // authority for the subtree and the replica mirrors its outcome after the
    // next pull rather than reimplementing it.
    const live = await reader.readNodes(spaceId, 'live');
    expect(live.map((n) => n.id)).toEqual([child]);

    expect((await repo.restoreNode(folder)).isOk()).toBe(true);
    expect((await reader.readNodes(spaceId, 'trashed'))).toEqual([]);

    await db.close();
  });

  it('purges a node with the edges that pointed at it', async () => {
    const { db, repo, reader, spaceId, node } = await open();
    const folder = await node('Folder');
    const doc = await node('Doc', folder);

    expect((await repo.purgeNode(doc)).isOk()).toBe(true);
    expect(await reader.readNode(doc)).toBeNull();
    // No foreign keys hold the replica together, so the edges go here.
    expect(await reader.readEdges(spaceId, 'contains')).toEqual([]);

    await db.close();
  });

  it('separates an open from an edit on the recency roll-ups', async () => {
    const { db, repo, reader, spaceId, node } = await open();
    const doc = await node('Doc');
    const before = await reader.readNode(doc);

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await repo.markOpened(spaceId, doc, TEST_USER)).isOk()).toBe(true);

    const after = await reader.readNode(doc);
    expect(after?.lastActivityAt.getTime()).toBeGreaterThan(
      before!.lastActivityAt.getTime()
    );
    // An open is activity, never an edit: the "Modified" column must not move.
    expect(after?.lastModifiedAt.getTime()).toBe(
      before!.lastModifiedAt.getTime()
    );

    await db.close();
  });

  it('rejects a command naming a node the replica does not hold', async () => {
    const { db, repo } = await open();
    const result = await repo.renameNode(
      'knr_000000000000000a.0000000000',
      'Nowhere'
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain('not in the local replica');
    await db.close();
  });
});
