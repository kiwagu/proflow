import { describe, expect, it } from 'vitest';
import { openTestDb, TEST_USER } from './graph.test-db.js';
import { createPgliteGraphReader } from './graph.reader.js';
import { createPgliteGraphRepository, GRAPH_OPS } from './graph.repository.js';
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

  it('reports the database conflict without journaling a second create', async () => {
    const { db, repo, ledger, spaceId } = await open();
    const id = 'knr_0000000000000009.0000000000';
    const input = {
      spaceId,
      id,
      kind: 'text' as const,
      title: 'First',
      createdBy: TEST_USER,
    };
    expect((await repo.createNode(input)).isOk()).toBe(true);
    const result = await repo.createNode({ ...input, title: 'Conflicting' });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain('duplicate key');
    expect(result._unsafeUnwrapErr()).toContain('knowledge_resources_pkey');
    expect(await ledger.pendingCount(spaceId)).toBe(1);
    const { rows } = await db.query<{ title: string }>(
      'select title from knowledge_resources where id = $1',
      [id]
    );
    expect(rows).toEqual([{ title: 'First' }]);

    await db.close();
  });

  it('reports the database CHECK failure without journaling a create', async () => {
    const { db, repo, ledger, spaceId } = await open();
    const result = await repo.createNode({
      spaceId,
      id: 'invalid-id',
      kind: 'text',
      title: 'Invalid',
      createdBy: TEST_USER,
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain('check constraint');
    expect(await ledger.pendingCount(spaceId)).toBe(0);
    await db.close();
  });

  it('returns the inserted snapshot even when sync deletes it after commit', async () => {
    const { db, spaceId } = await open();
    const id = 'knr_0000000000000009.0000000000';
    const repo = createPgliteGraphRepository({
      query: db.query.bind(db),
      transaction: async (run) => {
        const result = await db.transaction(run);
        await db.query('delete from knowledge_resources where id = $1', [id]);
        return result;
      },
    });
    const result = await repo.createNode({
      spaceId,
      id,
      kind: 'text',
      title: 'Created',
      createdBy: TEST_USER,
    });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toMatchObject({ id, title: 'Created' });
    expect((await db.query('select id from knowledge_resources')).rows).toEqual(
      []
    );
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
    expect(await reader.readNodes(spaceId, 'trashed')).toEqual([]);

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

  it('copies a subtree under fresh ids and journals the whole id map', async () => {
    const { db, repo, reader, ledger, spaceId, node } = await open();
    const source = await node('Source');
    const child = await node('Child', source);
    const target = await node('Target');

    const result = await repo.copySubtree({
      spaceId,
      sourceId: source,
      targetFolderId: target,
      createdBy: TEST_USER,
      rootTitle: 'Source (copy)',
    });
    expect(result.isOk()).toBe(true);
    const { nodeId, idMap } = result._unsafeUnwrap();

    // Every source node has a distinct copy, and the copies are real rows.
    expect(Object.keys(idMap).sort()).toEqual([source, child].sort());
    expect(nodeId).toBe(idMap[source]);
    expect((await reader.readNode(nodeId))?.title).toBe('Source (copy)');
    expect((await reader.readNode(idMap[child] as string))?.title).toBe(
      'Child'
    );
    // A copy is the copier's own private content, never the source's audience.
    expect((await reader.readNode(nodeId))?.visibility).toBe('private');

    // The subtree's shape is reproduced, and the root lands in the target.
    const edges = await reader.readEdges(spaceId, 'contains');
    const pairs = edges.map((edge) => `${edge.from}->${edge.to}`);
    expect(pairs).toContain(`${idMap[source]}->${idMap[child]}`);
    expect(pairs).toContain(`${target}->${idMap[source]}`);

    // The journal carries the id map, which is what lets the server's replay
    // attach the copied bodies and satellites to these very rows.
    const ops = await ledger.pendingOps(spaceId);
    const copyOp = ops.find((op) => op.op === GRAPH_OPS.copySubtree);
    expect(copyOp?.payload.idMap).toEqual(idMap);
    expect(copyOp?.nodeIds).toEqual(
      expect.arrayContaining([source, child, nodeId])
    );

    await db.close();
  });

  it('refuses to copy a source the replica does not hold', async () => {
    const { db, repo, spaceId } = await open();
    const result = await repo.copySubtree({
      spaceId,
      sourceId: 'knr_000000000000000b.0000000000',
      targetFolderId: null,
      createdBy: TEST_USER,
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain('not in the local replica');
    await db.close();
  });

  describe('moveNode', () => {
    const containsParents = async (
      db: Awaited<ReturnType<typeof open>>['db'],
      nodeId: string
    ) => {
      const { rows } = await db.query<{ from_id: string }>(
        `select from_id from knowledge_edges
          where to_id = $1 and relation_type = 'contains'`,
        [nodeId]
      );
      return rows.map((row) => row.from_id);
    };

    it('re-parents in one transaction and journals exactly one move_node', async () => {
      const { db, repo, ledger, spaceId, node } = await open();
      const source = await node('Source');
      const target = await node('Target');
      const doc = await node('Doc', source);
      const before = await ledger.pendingCount(spaceId);

      const result = await repo.moveNode(
        { spaceId, nodeId: doc, targetParentId: target, position: 2 },
        TEST_USER
      );
      expect(result.isOk()).toBe(true);

      expect(await containsParents(db, doc)).toEqual([target]);
      const ops = await ledger.pendingOps(spaceId);
      const moves = ops.filter((op) => op.op === GRAPH_OPS.moveNode);
      expect(moves).toHaveLength(1);
      expect(await ledger.pendingCount(spaceId)).toBe(before + 1);
      // The journal carries the contract shape and nothing else: the pusher
      // replays it as-is against the server RPC.
      expect(moves[0]?.payload).toEqual({
        spaceId,
        nodeId: doc,
        targetParentId: target,
        position: 2,
      });
      expect(new Set(moves[0]?.nodeIds)).toEqual(new Set([doc, target]));

      await db.close();
    });

    it('moves to top level by leaving no containment edge behind', async () => {
      const { db, repo, ledger, spaceId, node } = await open();
      const source = await node('Source');
      const doc = await node('Doc', source);
      const before = await ledger.pendingCount(spaceId);

      const result = await repo.moveNode(
        { spaceId, nodeId: doc, targetParentId: null, position: 0 },
        TEST_USER
      );
      expect(result.isOk()).toBe(true);
      expect(await containsParents(db, doc)).toEqual([]);
      expect(await ledger.pendingCount(spaceId)).toBe(before + 1);
      const last = (await ledger.pendingOps(spaceId)).at(-1);
      expect(last?.op).toBe(GRAPH_OPS.moveNode);
      expect(last?.nodeIds).toEqual([doc]);

      await db.close();
    });

    it('rejects input the contract refuses before touching the replica', async () => {
      const { db, repo, ledger, spaceId, node } = await open();
      const source = await node('Source');
      const doc = await node('Doc', source);
      const before = await ledger.pendingCount(spaceId);

      const result = await repo.moveNode(
        { spaceId, nodeId: doc, targetParentId: doc, position: 0 },
        TEST_USER
      );
      expect(result.isErr()).toBe(true);
      expect(await containsParents(db, doc)).toEqual([source]);
      expect(await ledger.pendingCount(spaceId)).toBe(before);

      await db.close();
    });

    it('rolls the detach back when the journal append fails', async () => {
      const { db, repo, ledger, spaceId, node } = await open();
      const source = await node('Source');
      const target = await node('Target');
      const doc = await node('Doc', source);
      const before = await ledger.pendingCount(spaceId);

      // Make the journal refuse this op kind: the edge writes then succeed
      // and the append raises, which is the failure the transaction exists
      // to contain — a replica row that changed with no intent to push.
      await db.query(
        `alter table graph_op_journal
           add constraint no_move_node check (op <> 'move_node')`
      );
      const result = await repo.moveNode(
        { spaceId, nodeId: doc, targetParentId: target, position: 0 },
        TEST_USER
      );
      expect(result.isErr()).toBe(true);
      expect(await containsParents(db, doc)).toEqual([source]);
      expect(await ledger.pendingCount(spaceId)).toBe(before);

      await db.close();
    });
  });
});
