import { newId } from '@workspace/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgliteGraphReplicaWriter } from './graph.replica.js';
import { createPgliteGraphRepository } from './graph.repository.js';
import { openTestDb, TEST_USER } from './graph.test-db.js';

/**
 * A pulled row is the server's truth, and the server may hold a row under
 * another id than the one this device minted for the same thing: a move is
 * replayed by an RPC that writes the edge itself, and a row two devices both
 * wrote keeps whichever id reached the server. The replica must take the
 * server's row then, not refuse it on its own uniqueness.
 */
const spaceId = 'spc_0000000000000001.0000000000';
const stamp = () => new Date().toISOString();

let db: Awaited<ReturnType<typeof openTestDb>>;
let repo: ReturnType<typeof createPgliteGraphRepository>;
let writer: ReturnType<typeof createPgliteGraphReplicaWriter>;

beforeAll(async () => {
  db = await openTestDb();
  repo = createPgliteGraphRepository(db);
  writer = createPgliteGraphReplicaWriter(db);
}, 30_000);
afterAll(async () => {
  await db?.close();
});

const node = async (kind: 'folder' | 'text', title: string) =>
  (
    await repo.createNode({
      spaceId,
      kind,
      title,
      createdBy: TEST_USER,
      parentId: null,
    })
  )._unsafeUnwrap().id;

describe('applying a pull to the replica', () => {
  it('takes the server edge of a move made here, which the server wrote under its own id', async () => {
    const folder = await node('folder', 'Second');
    const doc = await node('text', 'Doc');
    (
      await repo.moveNode(
        { spaceId, nodeId: doc, targetParentId: folder, position: 0 },
        TEST_USER
      )
    )._unsafeUnwrap();

    const serverId = newId('knowledgeEdge');
    await writer.applyPullBatch('knowledge_edges', [
      {
        id: serverId,
        space_id: spaceId,
        from_id: folder,
        to_id: doc,
        relation_type: 'contains',
        position: 0,
        metadata: {},
        created_by: TEST_USER,
        created_at: stamp(),
        updated_at: stamp(),
      },
    ]);

    const { rows } = await db.query<{ id: string }>(
      `select id from knowledge_edges
        where to_id = $1 and relation_type = 'contains'`,
      [doc]
    );
    expect(rows).toEqual([{ id: serverId }]);
  });

  it("takes the server's row for one user and one node, whichever device's id it kept", async () => {
    const doc = await node('text', 'Starred here');
    (await repo.setStarred(spaceId, doc, TEST_USER, true))._unsafeUnwrap();

    const serverId = newId('resourceUserState');
    await writer.applyPullBatch('resource_user_state', [
      {
        id: serverId,
        user_id: TEST_USER,
        resource_id: doc,
        space_id: spaceId,
        starred: true,
        updated_at: stamp(),
      },
    ]);

    const { rows } = await db.query<{ id: string; starred: boolean }>(
      'select id, starred from resource_user_state where resource_id = $1',
      [doc]
    );
    expect(rows).toEqual([{ id: serverId, starred: true }]);
  });

  it('still updates a row it already holds under the same id', async () => {
    const doc = await node('text', 'Before');
    const { rows: before } = await db.query<Record<string, unknown>>(
      'select * from knowledge_resources where id = $1',
      [doc]
    );
    await writer.applyPullBatch('knowledge_resources', [
      { ...(before[0] as { id: string }), title: 'After', updated_at: stamp() },
    ]);
    const { rows } = await db.query<{ title: string }>(
      'select title from knowledge_resources where id = $1',
      [doc]
    );
    expect(rows).toEqual([{ title: 'After' }]);
  });
});
