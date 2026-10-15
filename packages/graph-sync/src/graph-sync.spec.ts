import { entityIdRegistry } from '@workspace/entity-id';
import {
  OTHER_USER,
  TEST_USER,
} from '@workspace/persistence-pglite/testing/graph';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Replica } from './testing/replica.js';
import { createReplica } from './testing/replica.js';
import type { ServerStandIn } from './testing/server-stand-in.js';
import type { GraphRowTransport } from './types.js';
import { createServerStandIn, mintId } from './testing/server-stand-in.js';

/**
 * Graph row replication, end to end: a real Postgres carrying the deployed
 * schema's guards on one side, a real PGlite carrying the app's own
 * migrations on the other, and the real engine between them.
 *
 * Nothing here is mocked. When a test says the server refused a move, a
 * plpgsql cycle guard actually raised; when it says a purge disappeared from
 * a second replica, the row was really deleted and the inventory diff really
 * noticed. That is the point: this layer's whole contract is what the SERVER
 * does with a proposal, so a stand-in that always says yes would test
 * nothing.
 */

const SPACE = entityIdRegistry.factories.spaceIdFactory.brand(
  'spc_0000000000000001.0000000000'
);

let server: ServerStandIn;
let alice: Replica;
let bob: Replica;

async function seedNode(
  id: string,
  title: string,
  overrides: Record<string, unknown> = {}
): Promise<void> {
  const row = {
    id,
    space_id: SPACE,
    kind: 'text',
    title,
    status: 'draft',
    visibility: 'space',
    created_by: TEST_USER,
    owner_user_id: TEST_USER,
    ...overrides,
  };
  const columns = Object.keys(row);
  await server.sql(
    `insert into knowledge_resources (${columns.join(', ')})
     values (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
    columns.map((column) => (row as Record<string, unknown>)[column])
  );
}

async function seedEdge(from: string, to: string, position = 0): Promise<void> {
  await server.sql(
    `insert into knowledge_edges
       (id, space_id, from_id, to_id, relation_type, position, created_by)
     values ($1, $2, $3, $4, 'contains', $5, $6)`,
    [mintId('knowledge_edges'), SPACE, from, to, position, TEST_USER]
  );
}

const NODE_A = 'knr_0000000000000001.0000000000';
const NODE_B = 'knr_0000000000000002.0000000000';

beforeEach(async () => {
  if (alice) await alice.close();
  if (bob) await bob.close();
  if (server) await server.close();
  server = await createServerStandIn();
  alice = await createReplica('alice', TEST_USER, server.as(TEST_USER));
  bob = await createReplica('bob', OTHER_USER, server.as(OTHER_USER));
});

describe('graph row replication — pull', () => {
  it('checks a space out and converges the replica on the server rows', async () => {
    await seedNode(NODE_A, 'Folder', { kind: 'folder' });
    await seedNode(NODE_B, 'Child');
    await seedEdge(NODE_A, NODE_B);

    const outcome = await alice.sync.pull(SPACE);

    expect(outcome.applied).toBe(3);
    const nodes = await alice.reader.readNodes(SPACE, 'live');
    expect(nodes.map((n) => n.title).sort()).toEqual(['Child', 'Folder']);
    // The forest is DERIVED locally over the replicated edges — the same
    // recursive walk the server resolver runs, now one local round-trip.
    const ancestors = await alice.reader.readAncestors(NODE_B);
    expect(ancestors.map((n) => n.id)).toEqual([NODE_A]);
  });

  it('picks up only what changed since the watermark, and re-reads the overlap', async () => {
    await seedNode(NODE_A, 'First');
    await alice.sync.pull(SPACE);

    await seedNode(NODE_B, 'Second');
    const second = await alice.sync.pull(SPACE);

    // The overlap window means the cursor re-reads a few seconds of history,
    // so the second pull sees the new row and may re-see the first. What it
    // must NOT do is miss the new one.
    expect(second.applied).toBeGreaterThanOrEqual(1);
    const titles = (await alice.reader.readNodes(SPACE, 'live')).map(
      (n) => n.title
    );
    expect(titles.sort()).toEqual(['First', 'Second']);
  });

  it('pages a catch-up larger than one request', async () => {
    for (let i = 0; i < 7; i++) {
      await seedNode(`knr_000000000000001${i}.0000000000`, `Node ${i}`);
    }
    const paged = await createReplica(
      'paged',
      TEST_USER,
      server.as(TEST_USER),
      {
        pullPageSize: 2,
      }
    );

    const outcome = await paged.sync.pull(SPACE);

    // Seven rows through a two-row page is four requests, not one: a pull
    // that stopped at the first page would park the cursor mid-history.
    expect(outcome.applied).toBeGreaterThanOrEqual(7);
    expect((await paged.reader.readNodes(SPACE, 'live')).length).toBe(7);
    await paged.close();
  });

  it('never shows a replica a row the server does not show that user', async () => {
    await seedNode(NODE_A, 'Shared', { visibility: 'space' });
    await seedNode(NODE_B, "Alice's private draft", { visibility: 'private' });

    await alice.sync.pull(SPACE);
    await bob.sync.pull(SPACE);

    // Access is enforced at the SOURCE: the replica is a cache of what the
    // server would show this user, so the private draft never travels.
    expect((await alice.reader.readNodes(SPACE, 'live')).length).toBe(2);
    expect(
      (await bob.reader.readNodes(SPACE, 'live')).map((n) => n.id)
    ).toEqual([NODE_A]);
  });
});

describe('graph row replication — disappearance', () => {
  it('evicts a purged row that no watermark scan could ever report', async () => {
    await seedNode(NODE_A, 'Doomed');
    await seedNode(NODE_B, 'Survivor');
    await alice.sync.pull(SPACE);
    expect((await alice.reader.readNodes(SPACE, 'live')).length).toBe(2);

    await server.sql('delete from knowledge_resources where id = $1', [NODE_A]);

    // A purge leaves NOTHING behind: no updated_at, no tombstone the client
    // can read. Only the id inventory diff can see it.
    const outcome = await alice.sync.pull(SPACE, { sweep: true });
    expect(outcome.evicted).toBeGreaterThanOrEqual(1);
    expect(
      (await alice.reader.readNodes(SPACE, 'live')).map((n) => n.id)
    ).toEqual([NODE_B]);
  });

  it('evicts a row the user may no longer see, by the same mechanism', async () => {
    await seedNode(NODE_A, 'Was shared', { visibility: 'space' });
    await bob.sync.pull(SPACE);
    expect((await bob.reader.readNodes(SPACE, 'live')).length).toBe(1);

    await server.sql(
      "update knowledge_resources set visibility = 'private' where id = $1",
      [NODE_A]
    );

    // Revocation is not a delete: the row still EXISTS, it is simply no
    // longer visible. Locally the two are indistinguishable — and must be,
    // since telling them apart is itself an access question.
    const outcome = await bob.sync.pull(SPACE, { sweep: true });
    expect(outcome.evicted).toBeGreaterThanOrEqual(1);
    expect((await bob.reader.readNodes(SPACE, 'live')).length).toBe(0);
  });

  it('does not sweep again before the interval, and sweeps on demand', async () => {
    await seedNode(NODE_A, 'Node');
    await alice.sync.pull(SPACE, { sweep: true });

    const quiet = await alice.sync.pull(SPACE);
    expect(quiet.swept).toEqual([]);

    const forced = await alice.sync.pull(SPACE, { sweep: true });
    expect(forced.swept.length).toBeGreaterThan(0);
  });
});

describe('graph row replication — push', () => {
  it('replays a journaled create and the server ends up holding it', async () => {
    const created = await alice.repo.createNode({
      spaceId: SPACE,
      kind: 'text',
      title: 'Written offline',
      createdBy: TEST_USER,
    });
    if (created.isErr()) throw new Error(created.error);

    const outcome = await alice.sync.push(SPACE);

    expect(outcome.accepted).toBe(1);
    expect(outcome.refused).toBe(0);
    const rows = await server.sql<{ title: string }>(
      'select title from knowledge_resources where id = $1',
      [created.value.id]
    );
    expect(rows[0]?.title).toBe('Written offline');
    expect(await alice.sync.pendingCount(SPACE)).toBe(0);
  });

  it('survives redelivery: replaying the same ops twice changes nothing', async () => {
    const created = await alice.repo.createNode({
      spaceId: SPACE,
      kind: 'text',
      title: 'Once',
      createdBy: TEST_USER,
    });
    if (created.isErr()) throw new Error(created.error);
    await alice.repo.renameNode(created.value.id, 'Twice');

    // Capture the journal BEFORE the drain, then re-journal it verbatim
    // afterwards — exactly what an at-least-once transport delivers when an
    // acknowledgement is lost on the way back.
    const ops = await alice.replica.pendingOps(SPACE);
    await alice.sync.push(SPACE);
    for (const op of ops) {
      await alice.journalRaw(op.spaceId, op.op, op.payload, op.nodeIds);
    }
    const replay = await alice.sync.push(SPACE);

    expect(replay.accepted).toBe(ops.length);
    expect(replay.refused).toBe(0);
    const rows = await server.sql<{ title: string }>(
      'select title from knowledge_resources where space_id = $1',
      [SPACE]
    );
    // One row, still carrying the LATER title: the redelivered create is an
    // ignore-duplicates upsert, so it cannot resurrect the original name.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('Twice');
  });

  it('writes only the columns a command touched, so concurrent edits both survive', async () => {
    await seedNode(NODE_A, 'Original');
    await alice.sync.pull(SPACE);

    await alice.repo.renameNode(NODE_A, 'Renamed by alice');
    // Someone else changes a DIFFERENT column in the meantime.
    await server.sql(
      "update knowledge_resources set status = 'active' where id = $1",
      [NODE_A]
    );
    await alice.sync.push(SPACE);

    const rows = await server.sql<{ title: string; status: string }>(
      'select title, status from knowledge_resources where id = $1',
      [NODE_A]
    );
    // Per-COLUMN last-write-wins: a whole-row overwrite would have reverted
    // the status the rename never looked at.
    expect(rows[0]).toEqual({ title: 'Renamed by alice', status: 'active' });
  });

  it('keeps an op queued when the server never reached a verdict', async () => {
    await alice.repo.createNode({
      spaceId: SPACE,
      kind: 'text',
      title: 'Composed offline',
      createdBy: TEST_USER,
    });
    server.setOffline(true);

    const stalled = await alice.sync.push(SPACE);

    expect(stalled.stalled).toBe(true);
    expect(stalled.accepted).toBe(0);
    // The op is still a valid proposal — discarding it here would throw
    // away work because the network blinked.
    expect(await alice.sync.pendingCount(SPACE)).toBe(1);

    server.setOffline(false);
    const resumed = await alice.sync.push(SPACE);
    expect(resumed.accepted).toBe(1);
    expect(await alice.sync.pendingCount(SPACE)).toBe(0);
  });

  it('drains the journal across a restart — the intent outlives the tab', async () => {
    await alice.repo.createNode({
      spaceId: SPACE,
      kind: 'text',
      title: 'Queued before the tab closed',
      createdBy: TEST_USER,
    });
    server.setOffline(true);
    await alice.sync.push(SPACE);

    // The engine is rebuilt against the same local database — the overlay
    // would be gone here, the journal is not.
    alice.restart();
    server.setOffline(false);
    const outcome = await alice.sync.push(SPACE);

    expect(outcome.accepted).toBe(1);
    const rows = await server.sql<{ title: string }>(
      'select title from knowledge_resources where space_id = $1',
      [SPACE]
    );
    expect(rows.map((r) => r.title)).toEqual(['Queued before the tab closed']);
  });
});

describe('graph row replication — refusal is reconciliation', () => {
  it('refuses an offline move that would form a cycle, and re-pulls the truth', async () => {
    await seedNode(NODE_A, 'Parent', { kind: 'folder' });
    await seedNode(NODE_B, 'Child', { kind: 'folder' });
    await seedEdge(NODE_A, NODE_B);
    await alice.sync.pull(SPACE);

    // The client's own guard refuses the reverse move locally...
    const guarded = await alice.repo.upsertEdge({
      spaceId: SPACE,
      from: NODE_B,
      to: NODE_A,
      relationType: 'contains',
      createdBy: TEST_USER,
    });
    expect(guarded.isErr()).toBe(true);

    // ...but a move composed on ANOTHER device never passed through it, and
    // arrives as a journaled op. That is why the server has its own cycle
    // guard: this is the write it exists to stop.
    await alice.journalRaw(
      SPACE,
      'upsert_edge',
      { from: NODE_B, to: NODE_A, relationType: 'contains', position: 0 },
      [NODE_B, NODE_A]
    );

    const outcome = await alice.sync.push(SPACE);

    expect(outcome.refused).toBe(1);
    expect(outcome.reconciled.sort()).toEqual([NODE_A, NODE_B].sort());
    // The graph is still a tree: the cycle never landed on either side.
    expect(
      await server.sql('select id from knowledge_edges where from_id = $1', [
        NODE_B,
      ])
    ).toHaveLength(0);
    const edges = await alice.reader.readEdges(SPACE, 'contains');
    expect(edges.map((e) => [e.from, e.to])).toEqual([[NODE_A, NODE_B]]);
  });

  it('drops a refused op with everything built on it and re-pulls those nodes', async () => {
    await seedNode(NODE_A, 'Alice can see this', { visibility: 'space' });
    await bob.sync.pull(SPACE);
    // Bob loses access between his pull and his push — the classic case
    // where a local proposal is already stale when it reaches the wire.
    await server.sql(
      "update knowledge_resources set visibility = 'private' where id = $1",
      [NODE_A]
    );

    await bob.repo.renameNode(NODE_A, 'Bob renames it');
    await bob.repo.setStatus(NODE_A, 'active');
    const unrelated = await bob.repo.createNode({
      spaceId: SPACE,
      kind: 'text',
      title: "Bob's own node",
      createdBy: OTHER_USER,
    });
    if (unrelated.isErr()) throw new Error(unrelated.error);

    const outcome = await bob.sync.push(SPACE);

    expect(outcome.refused).toBe(1);
    expect(outcome.reconciled).toContain(NODE_A);
    // The refused rename AND the set-status built on it are gone; the
    // unrelated create is untouched and still pushes.
    const remaining = await bob.replica.pendingOps(SPACE);
    expect(remaining.map((op) => op.op)).toEqual(['create_node']);

    // The pull IS the rollback: the node Bob may no longer see is evicted
    // rather than left showing his optimistic rename forever.
    expect(await bob.reader.readNode(NODE_A)).toBeNull();
    const server_rows = await server.sql<{ title: string }>(
      'select title from knowledge_resources where id = $1',
      [NODE_A]
    );
    expect(server_rows[0]?.title).toBe('Alice can see this');
  });

  it('reports one reconciliation to the caller for the non-modal notice', async () => {
    await seedNode(NODE_A, 'Shared', { visibility: 'space' });
    const watcher = await createReplica(
      'watcher',
      OTHER_USER,
      server.as(OTHER_USER),
      { onReconciled: (event) => events.push(event) }
    );
    const events: { refused: number; nodeIds: string[] }[] = [];
    await watcher.sync.pull(SPACE);
    await server.sql(
      "update knowledge_resources set visibility = 'private' where id = $1",
      [NODE_A]
    );

    await watcher.repo.renameNode(NODE_A, 'Nope');
    await watcher.sync.push(SPACE);

    expect(events).toHaveLength(1);
    expect(events[0]?.refused).toBe(1);
    expect(events[0]?.nodeIds).toContain(NODE_A);
    await watcher.close();
  });
});

describe('graph row replication — atomic move', () => {
  const NODE_C = 'knr_0000000000000003.0000000000';

  it('replays a local move as one rpc and the server holds exactly one parent', async () => {
    await seedNode(NODE_A, 'Source', { kind: 'folder' });
    await seedNode(NODE_B, 'Target', { kind: 'folder' });
    await seedNode(NODE_C, 'Doc');
    await seedEdge(NODE_A, NODE_C);
    await alice.sync.pull(SPACE);

    const moved = await alice.repo.moveNode(
      { spaceId: SPACE, nodeId: NODE_C, targetParentId: NODE_B, position: 1 },
      TEST_USER
    );
    expect(moved.isOk()).toBe(true);
    const outcome = await alice.sync.push(SPACE);
    expect(outcome.refused).toBe(0);

    const parents = await server.sql<{ from_id: string; position: number }>(
      `select from_id, position from knowledge_edges
        where to_id = $1 and relation_type = 'contains'`,
      [NODE_C]
    );
    expect(parents).toEqual([{ from_id: NODE_B, position: 1 }]);

    // Lost-ack redelivery: the same journal row arrives again. One RPC, one
    // parent — the second delivery changes nothing.
    await alice.journalRaw(
      SPACE,
      'move_node',
      { spaceId: SPACE, nodeId: NODE_C, targetParentId: NODE_B, position: 1 },
      [NODE_C, NODE_B]
    );
    const replay = await alice.sync.push(SPACE);
    expect(replay.refused).toBe(0);
    expect(
      await server.sql(
        `select id from knowledge_edges where to_id = $1 and relation_type = 'contains'`,
        [NODE_C]
      )
    ).toHaveLength(1);
  });

  it('refuses a move that would form a cycle and re-pulls the prior parent', async () => {
    await seedNode(NODE_A, 'Parent', { kind: 'folder' });
    await seedNode(NODE_B, 'Child', { kind: 'folder' });
    await seedEdge(NODE_A, NODE_B);
    const events: { refused: number; nodeIds: string[] }[] = [];
    const watcher = await createReplica(
      'watcher',
      TEST_USER,
      server.as(TEST_USER),
      { onReconciled: (event) => events.push(event) }
    );
    await watcher.sync.pull(SPACE);

    // Composed on another device, so the local guard never saw it.
    await watcher.journalRaw(
      SPACE,
      'move_node',
      { spaceId: SPACE, nodeId: NODE_A, targetParentId: NODE_B, position: 0 },
      [NODE_A, NODE_B]
    );
    const outcome = await watcher.sync.push(SPACE);

    expect(outcome.refused).toBe(1);
    expect(await watcher.replica.pendingOps(SPACE)).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]?.refused).toBe(1);
    const edges = await watcher.reader.readEdges(SPACE, 'contains');
    expect(edges.map((e) => [e.from, e.to])).toEqual([[NODE_A, NODE_B]]);
    expect(
      await server.sql(`select id from knowledge_edges where to_id = $1`, [
        NODE_A,
      ])
    ).toHaveLength(0);
    await watcher.close();
  });
});

describe('graph row replication — trash', () => {
  it('mirrors the server cascade instead of reimplementing it locally', async () => {
    await seedNode(NODE_A, 'Folder', { kind: 'folder' });
    await seedNode(NODE_B, 'Only child');
    await seedEdge(NODE_A, NODE_B);
    await alice.sync.pull(SPACE);

    await alice.repo.trashNode(NODE_A, TEST_USER);
    // Locally only the folder's own columns moved: the replica does NOT
    // reimplement the cascade, it waits to be told what the server did.
    expect(
      (await alice.reader.readNodes(SPACE, 'trashed')).map((n) => n.id)
    ).toEqual([NODE_A]);

    await alice.sync.push(SPACE);
    await alice.sync.pull(SPACE);

    // After the round-trip, the orphaned child is trashed too — stamped by
    // the SERVER's cascade with the same instant, so a restore can still see
    // the subtree as one unit.
    const trashed = await alice.reader.readNodes(SPACE, 'trashed');
    expect(trashed.map((n) => n.id).sort()).toEqual([NODE_A, NODE_B].sort());
    const stamps = new Set(trashed.map((n) => n.deletedAt?.getTime()));
    expect(stamps.size).toBe(1);
  });

  it('restores through the same path, and the Trash lens empties', async () => {
    await seedNode(NODE_A, 'Trashed already', {
      deleted_at: new Date(),
      trashed_by: TEST_USER,
    });
    await alice.sync.pull(SPACE);
    expect((await alice.reader.readNodes(SPACE, 'trashed')).length).toBe(1);

    await alice.repo.restoreNode(NODE_A);
    await alice.sync.push(SPACE);
    await alice.sync.pull(SPACE);

    expect((await alice.reader.readNodes(SPACE, 'trashed')).length).toBe(0);
    expect(
      (await alice.reader.readNodes(SPACE, 'live')).map((n) => n.id)
    ).toEqual([NODE_A]);
  });

  it('purges on both sides and the second replica notices by inventory', async () => {
    await seedNode(NODE_A, 'To purge');
    await alice.sync.pull(SPACE);
    await bob.sync.pull(SPACE);

    await alice.repo.purgeNode(NODE_A);
    await alice.sync.push(SPACE);

    expect(
      await server.sql('select id from knowledge_resources where id = $1', [
        NODE_A,
      ])
    ).toHaveLength(0);
    const outcome = await bob.sync.pull(SPACE, { sweep: true });
    expect(outcome.evicted).toBeGreaterThanOrEqual(1);
    expect(await bob.reader.readNode(NODE_A)).toBeNull();
  });
});

describe('graph row replication — starred and per-user state', () => {
  it('pushes a star and never lets another user see it', async () => {
    await seedNode(NODE_A, 'Shared', { visibility: 'space' });
    await alice.sync.pull(SPACE);
    await bob.sync.pull(SPACE);

    await alice.repo.setStarred(SPACE, NODE_A, TEST_USER, true);
    await alice.sync.push(SPACE);
    await bob.sync.pull(SPACE);

    const mine = await server.sql<{ starred: boolean }>(
      'select starred from resource_user_state where user_id = $1',
      [TEST_USER]
    );
    expect(mine[0]?.starred).toBe(true);
    // Per-user state is own-rows-only BY CONSTRUCTION: the pull runs under
    // Bob's identity, so Alice's star is not a row he can ever hold.
    expect(await bob.rows('resource_user_state')).toHaveLength(0);
  });

  it('converges a star made on one device onto another device of the same user', async () => {
    await seedNode(NODE_A, 'Shared', { visibility: 'space' });
    const laptop = await createReplica(
      'laptop',
      TEST_USER,
      server.as(TEST_USER)
    );
    await alice.sync.pull(SPACE);
    await laptop.sync.pull(SPACE);

    await alice.repo.setStarred(SPACE, NODE_A, TEST_USER, true);
    await alice.sync.push(SPACE);
    await laptop.sync.pull(SPACE);

    const starred = await laptop.rows<{ starred: boolean }>(
      'resource_user_state'
    );
    expect(starred.map((row) => row.starred)).toEqual([true]);
    await laptop.close();
  });
});

describe('graph row replication — watch', () => {
  it('feeds the live queries: a pull landing rows fires watchNodes', async () => {
    // The replica writes into the same tables the read vocabulary's live
    // queries observe, so hydrate and refresh reach the UI with no extra
    // plumbing: the pull IS the notification.
    const seen: string[][] = [];
    const unsubscribe = alice.reader.watchNodes(SPACE, 'live', (nodes) =>
      seen.push(nodes.map((n) => n.title))
    );

    await seedNode(NODE_A, 'Hydrated');
    await alice.sync.pull(SPACE);
    await waitFor(async () =>
      seen.some((titles) => titles.includes('Hydrated'))
    );

    await seedNode(NODE_B, 'Refreshed');
    await alice.sync.pull(SPACE);
    await waitFor(async () =>
      seen.some((titles) => titles.includes('Refreshed'))
    );

    unsubscribe();
    // The live extension detaches asynchronously; give it a beat so the
    // teardown does not race the next test's database close.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  /**
   * The engine keeps no clock and opens no subscription: whoever composes it
   * decides when a cycle runs (a heartbeat, a change signal, a local write)
   * and kicks it. What is pinned here is what a kick does, and that nothing
   * else ever starts one.
   */
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The replica's transport, with every call counted and pulls holdable. */
  function counted(base: GraphRowTransport) {
    let gate: Promise<void> | null = null;
    let inventories = 0;
    let pulls = 0;
    /** 1-based call numbers that answer with a server error instead. */
    const failing = {
      inventory: new Set<number>(),
      pullSince: new Set<number>(),
    };
    const unavailable = () => new Error('503 Service Unavailable');
    const port = {
      pullSince: vi.fn(
        async (...args: Parameters<GraphRowTransport['pullSince']>) => {
          if (gate) await gate;
          pulls += 1;
          if (failing.pullSince.has(pulls)) throw unavailable();
          return base.pullSince(...args);
        }
      ),
      inventory: vi.fn(
        async (...args: Parameters<GraphRowTransport['inventory']>) => {
          inventories += 1;
          if (failing.inventory.has(inventories)) throw unavailable();
          return base.inventory(...args);
        }
      ),
      pullByNodes: vi.fn(base.pullByNodes),
      write: vi.fn(base.write),
    } satisfies GraphRowTransport;
    // A channel the engine must never open: hearing that the space changed
    // is its composer's business, which then kicks it.
    const transport = Object.assign(port, { subscribe: vi.fn() });
    return {
      transport,
      failing,
      calls: () => ({ inventories, pulls }),
      /** Pulls wait until the returned release is called. */
      hold() {
        let release!: () => void;
        gate = new Promise<void>((resolve) => {
          release = () => {
            gate = null;
            resolve();
          };
        });
        return release;
      },
    };
  }

  async function watched() {
    const spy = counted(server.as(TEST_USER));
    const replica = await createReplica('watched', TEST_USER, spy.transport);
    const pulls: { swept: string[] }[] = [];
    const pushes: number[] = [];
    const order: string[] = [];
    const errors: unknown[] = [];
    const watch = replica.sync.watch(SPACE, {
      onPush: (outcome) => {
        pushes.push(outcome.accepted);
        order.push('push');
      },
      onPull: (outcome) => {
        pulls.push({ swept: outcome.swept });
        order.push('pull');
      },
      onError: (error) => errors.push(error),
    });
    /** Every cycle so far has ended, one way or the other. */
    const ended = (cycles: number) =>
      waitFor(async () => w.pulls.length + w.errors.length === cycles);
    const w = { ...spy, replica, watch, pulls, pushes, order, errors, ended };
    return w;
  }

  it('a sweep asked for while one runs, that then fails, stays owed though the sweep before it went through', async () => {
    const w = await watched();
    await w.ended(1);
    expect(w.watch.owed()).toBeNull();
    // Sweep A runs; sweep B is asked for meanwhile and waits behind it.
    // A's inventory calls are 8–14 (the checkout's were 1–7); B's first
    // one fails.
    w.failing.inventory.add(15);
    w.watch.kick({ sweep: true });
    w.watch.kick({ sweep: true });
    await w.ended(3);
    expect(w.pulls).toHaveLength(2);
    expect(w.errors).toHaveLength(1);
    expect(w.watch.owed()).toEqual({ sweep: true });

    // A plain pass going through does not settle it.
    w.watch.kick();
    await w.ended(4);
    expect(w.watch.owed()).toEqual({ sweep: true });
    // A sweep does.
    w.watch.kick({ sweep: true });
    await w.ended(5);
    expect(w.watch.owed()).toBeNull();
    w.watch.stop();
    await w.replica.close();
  });

  it('a sweep a deletion signal asked for, failing after the checkout went through, stays owed as a sweep', async () => {
    const w = await watched();
    await w.ended(1);
    w.failing.inventory.add(8);
    // What the composition does with a deletion signal.
    w.watch.kick({ sweep: true });
    await w.ended(2);
    expect(w.watch.owed()).toEqual({ sweep: true });
    w.watch.stop();
    await w.replica.close();
  });

  it('a plain pass that failed stays owed until a pass goes through; so does a push that found the server away', async () => {
    const w = await watched();
    await w.ended(1);
    const { pulls } = w.calls();
    w.failing.pullSince.add(pulls + 1);
    w.watch.kick();
    await w.ended(2);
    expect(w.watch.owed()).toEqual({ sweep: false });
    w.watch.kick();
    await w.ended(3);
    expect(w.watch.owed()).toBeNull();

    // Writes waiting while the server is away: the reads go through, the
    // cycle is still owed.
    const created = await w.replica.repo.createNode({
      spaceId: SPACE,
      kind: 'text',
      title: 'Waiting',
      createdBy: TEST_USER,
    });
    if (created.isErr()) throw new Error(created.error);
    server.setOffline(true);
    w.watch.kick();
    await w.ended(4);
    expect(w.watch.owed()).toEqual({ sweep: false });
    server.setOffline(false);
    w.watch.kick();
    await w.ended(5);
    expect(w.watch.owed()).toBeNull();
    w.watch.stop();
    await w.replica.close();
  });

  it('checks the space out with one sweeping cycle and nothing else', async () => {
    const w = await watched();
    await waitFor(async () => w.pulls.length === 1);
    expect(w.pulls[0]?.swept.length).toBe(7);
    w.watch.stop();
    await w.replica.close();
  });

  it('does not poll on its own', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const w = await watched();
    await waitFor(async () => w.pulls.length === 1);
    const pullsAfterCheckout = w.transport.pullSince.mock.calls.length;

    vi.advanceTimersByTime(60_000);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(w.transport.pullSince.mock.calls.length).toBe(pullsAfterCheckout);
    expect(w.pulls.length).toBe(1);
    w.watch.stop();
    await w.replica.close();
  });

  it('opens no channel of its own, even on a transport that offers one', async () => {
    const w = await watched();
    await waitFor(async () => w.pulls.length === 1);
    w.watch.kick({ sweep: true });
    await w.ended(2);
    expect(w.transport.subscribe).not.toHaveBeenCalled();
    w.watch.stop();
    await w.replica.close();
  });

  it('a kick pushes first and then pulls; a sweeping kick sweeps', async () => {
    const w = await watched();
    await waitFor(async () => w.pulls.length === 1);
    const created = await w.replica.repo.createNode({
      spaceId: SPACE,
      kind: 'text',
      title: 'Kicked out',
      createdBy: TEST_USER,
    });
    if (created.isErr()) throw new Error(created.error);
    w.order.length = 0;

    w.watch.kick();
    await waitFor(async () => w.pulls.length === 2);

    expect(w.order).toEqual(['push', 'pull']);
    expect(w.pushes.at(-1)).toBe(1);
    expect(w.pulls[1]?.swept).toEqual([]);
    const rows = await server.sql<{ title: string }>(
      'select title from knowledge_resources where id = $1',
      [created.value.id]
    );
    expect(rows[0]?.title).toBe('Kicked out');

    await seedNode(NODE_A, 'Gone soon');
    await w.replica.sync.pull(SPACE);
    await server.sql('delete from knowledge_resources where id = $1', [NODE_A]);
    w.watch.kick({ sweep: true });
    await waitFor(async () => w.pulls.length === 3);
    expect(w.pulls[2]?.swept.length).toBe(7);
    expect(await w.replica.reader.readNode(NODE_A)).toBeNull();
    w.watch.stop();
    await w.replica.close();
  });

  it('kicks during a cycle run exactly one more, and a sweep asked for is kept', async () => {
    const w = await watched();
    await waitFor(async () => w.pulls.length === 1);

    const release = w.hold();
    w.watch.kick();
    await waitFor(async () => w.transport.pullSince.mock.calls.length > 7);
    // While that cycle waits on the server: a sweeping kick, then a plain one.
    w.watch.kick({ sweep: true });
    w.watch.kick();
    w.watch.kick();
    release();

    await waitFor(async () => w.pulls.length === 3);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(w.pulls.length).toBe(3);
    expect(w.pulls[1]?.swept).toEqual([]);
    expect(w.pulls[2]?.swept.length).toBe(7);
    w.watch.stop();
    await w.replica.close();
  });

  it('stops cleanly: a kick after the stop does nothing, and no pull lands', async () => {
    const w = await watched();
    await waitFor(async () => w.pulls.length === 1);
    w.watch.stop();
    const calls = w.transport.pullSince.mock.calls.length;

    await seedNode(NODE_A, 'After the stop');
    w.watch.kick();
    w.watch.kick({ sweep: true });
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(w.transport.pullSince.mock.calls.length).toBe(calls);
    expect(await w.replica.reader.readNode(NODE_A)).toBeNull();
    await w.replica.close();
  });
});

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 5_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error('condition never held');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
