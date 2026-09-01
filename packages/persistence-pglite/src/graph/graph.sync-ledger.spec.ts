import { describe, expect, it } from 'vitest';
import { openTestDb, TEST_USER } from './graph.test-db.js';
import { createPgliteGraphReader } from './graph.reader.js';
import { createPgliteGraphRepository } from './graph.repository.js';
import { createPgliteGraphReplicaWriter } from './graph.replica.js';
import {
  createPgliteGraphSyncLedger,
  INVENTORY_INTERVAL_MS,
  PULL_OVERLAP_MS,
} from './graph.sync-ledger.js';

const SPACE = 'spc_0000000000000001.0000000000';

async function open() {
  const db = await openTestDb();
  return {
    db,
    ledger: createPgliteGraphSyncLedger(db),
    writer: createPgliteGraphReplicaWriter(db),
    reader: createPgliteGraphReader(db),
    repo: createPgliteGraphRepository(db),
  };
}

function serverNode(id: string, title: string, updatedAt: Date) {
  return {
    id,
    space_id: SPACE,
    kind: 'text',
    title,
    status: 'draft',
    visibility: 'private',
    created_by: TEST_USER,
    owner_user_id: TEST_USER,
    last_modified_at: updatedAt,
    last_activity_at: updatedAt,
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}

const NODE_A = 'knr_0000000000000001.0000000000';
const NODE_B = 'knr_0000000000000002.0000000000';

describe('graph sync ledger', () => {
  it('starts with no cursor and hands back a watermark backed off by the overlap', async () => {
    const { db, ledger } = await open();
    expect(await ledger.cursorFor(SPACE, 'knowledge_resources')).toBeNull();

    const at = new Date('2026-09-01T10:00:00.000Z');
    await ledger.advanceCursor(SPACE, 'knowledge_resources', at);

    const cursor = await ledger.cursorFor(SPACE, 'knowledge_resources');
    // The overlap window is re-read on every pull, so two rows written in the
    // same millisecond — one after the cursor was taken — cannot be skipped.
    expect(cursor?.getTime()).toBe(at.getTime() - PULL_OVERLAP_MS);

    await db.close();
  });

  it('never moves a watermark backwards when pulls interleave', async () => {
    const { db, ledger } = await open();
    const newer = new Date('2026-09-01T10:00:00.000Z');
    const older = new Date('2026-09-01T09:00:00.000Z');

    await ledger.advanceCursor(SPACE, 'knowledge_resources', newer);
    await ledger.advanceCursor(SPACE, 'knowledge_resources', older);

    expect(
      (await ledger.cursorFor(SPACE, 'knowledge_resources'))?.getTime()
    ).toBe(newer.getTime() - PULL_OVERLAP_MS);

    await db.close();
  });

  it('applies a pull batch as the server truth and reports its watermark', async () => {
    const { db, ledger, writer, reader } = await open();
    const first = new Date('2026-09-01T10:00:00.000Z');
    const second = new Date('2026-09-01T10:05:00.000Z');

    const watermark = await writer.applyPullBatch('knowledge_resources', [
      serverNode(NODE_A, 'From server', first),
      serverNode(NODE_B, 'Also from server', second),
    ]);
    expect(watermark?.getTime()).toBe(second.getTime());
    expect((await reader.readNodes(SPACE, 'live')).map((n) => n.title)).toEqual([
      'Also from server',
      'From server',
    ]);

    // A later pull of the same row overwrites it: the server is the sole
    // authority for these rows, so what arrives IS the current truth.
    await writer.applyPullBatch('knowledge_resources', [
      serverNode(NODE_A, 'Renamed on the server', second),
    ]);
    expect((await reader.readNode(NODE_A))?.title).toBe(
      'Renamed on the server'
    );

    // An empty batch moves nothing, so the cursor must not move either.
    expect(await writer.applyPullBatch('knowledge_resources', [])).toBeNull();

    await ledger.advanceCursor(SPACE, 'knowledge_resources', second);
    await db.close();
  });

  it('deletes locally what an inventory no longer lists', async () => {
    const { db, ledger, writer, reader } = await open();
    const at = new Date('2026-09-01T10:00:00.000Z');
    await writer.applyPullBatch('knowledge_resources', [
      serverNode(NODE_A, 'Still visible', at),
      serverNode(NODE_B, 'Purged or revoked', at),
    ]);

    // The inventory is what the server shows THIS user now. A row missing
    // from it was purged or is no longer visible — indistinguishable
    // locally, and handled identically.
    const removed = await ledger.applyInventory(SPACE, 'knowledge_resources', [
      NODE_A,
    ]);
    expect(removed).toBe(1);
    expect((await reader.readNodes(SPACE, 'live')).map((n) => n.id)).toEqual([
      NODE_A,
    ]);

    await db.close();
  });

  it('reports an inventory sweep as due until it runs, then not before the interval', async () => {
    const { db, ledger } = await open();
    expect(await ledger.inventoryDue(SPACE, 'knowledge_resources')).toBe(true);

    await ledger.applyInventory(SPACE, 'knowledge_resources', []);
    expect(await ledger.inventoryDue(SPACE, 'knowledge_resources')).toBe(false);
    expect(await ledger.inventoryAt(SPACE, 'knowledge_resources')).toBeInstanceOf(
      Date
    );

    const later = new Date(Date.now() + INVENTORY_INTERVAL_MS + 1_000);
    expect(await ledger.inventoryDue(SPACE, 'knowledge_resources', later)).toBe(
      true
    );

    await db.close();
  });

  it('acks one op and leaves the rest of the queue in order', async () => {
    const { db, ledger, repo } = await open();
    const created = await repo.createNode({
      spaceId: SPACE,
      kind: 'text',
      title: 'Doc',
      createdBy: TEST_USER,
    });
    if (created.isErr()) throw new Error(created.error);
    await repo.renameNode(created.value.id, 'Doc v2');

    const ops = await ledger.pendingOps(SPACE);
    expect(ops).toHaveLength(2);
    await ledger.ackOp(ops[0]!.id);

    const rest = await ledger.pendingOps(SPACE);
    expect(rest.map((op) => op.id)).toEqual([ops[1]!.id]);

    await db.close();
  });

  it('drops a refused op and every later op touching the same node', async () => {
    const { db, ledger, repo } = await open();
    const doc = await repo.createNode({
      spaceId: SPACE,
      kind: 'text',
      title: 'Doc',
      createdBy: TEST_USER,
    });
    if (doc.isErr()) throw new Error(doc.error);
    const unrelated = await repo.createNode({
      spaceId: SPACE,
      kind: 'text',
      title: 'Unrelated',
      createdBy: TEST_USER,
    });
    if (unrelated.isErr()) throw new Error(unrelated.error);

    await repo.renameNode(doc.value.id, 'Doc v2');
    await repo.setStatus(doc.value.id, 'active');
    await repo.renameNode(unrelated.value.id, 'Unrelated v2');

    const ops = await ledger.pendingOps(SPACE);
    const rename = ops.find(
      (op) => op.nodeIds.includes(doc.value.id) && op.op === 'rename_node'
    );

    const affected = await ledger.rejectOp(rename!.id);
    expect(affected).toEqual([doc.value.id]);

    const remaining = await ledger.pendingOps(SPACE);
    // The refused rename and the later set-status on the same node are gone —
    // an op built on a state the server never had cannot be replayed. The
    // earlier creates stand (they were accepted) and the unrelated node's
    // rename is untouched.
    expect(remaining.map((op) => op.op)).toEqual([
      'create_node',
      'create_node',
      'rename_node',
    ]);
    expect(remaining[2]?.nodeIds).toEqual([unrelated.value.id]);

    await db.close();
  });

  it('refuses a table it does not replicate', async () => {
    const { db, writer } = await open();
    await expect(
      writer.applyPullBatch(
        'grants' as never,
        [{ id: NODE_A }]
      )
    ).rejects.toThrow('not a replicated table');
    await db.close();
  });
});
