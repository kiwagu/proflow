import { entityIdRegistry, type SpaceId } from '@workspace/entity-id';
import {
  OTHER_USER,
  TEST_USER,
} from '@workspace/persistence-pglite/testing/graph';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MalformedServerRowError } from './index.js';
import { createSupabaseGraphRowTransport } from './supabase-transport.js';
import { createReplica, type Replica } from './testing/replica.js';
import {
  createServerStandIn,
  type ServerStandIn,
} from './testing/server-stand-in.js';

/**
 * Ids enter the replica from the server, and that is where they are checked:
 * every id column a replicated row carries must be a well-formed id of the
 * kind its column holds. A row that is not is refused on its own — the rest
 * of its page lands and the cursor moves on, so one bad row cannot stall the
 * table — and it is reported once, not on every pass that meets it again.
 */

const { knowledgeResourceIdFactory, spaceIdFactory } =
  entityIdRegistry.factories;

const SPACE = spaceIdFactory.brand('spc_0000000000000001.0000000000');
const GOOD = 'knr_0000000000000001.0000000000';
const BROKEN = "knr_' OR 1=1--";

let server: ServerStandIn;
let alice: Replica;

async function seedNode(id: string, title: string): Promise<void> {
  await server.sql(
    `insert into knowledge_resources
       (id, space_id, kind, title, visibility, created_by, owner_user_id)
     values ($1, $2, 'text', $3, 'space', $4, $4)`,
    [id, SPACE, title, TEST_USER]
  );
}

const localIds = async (r: Replica) =>
  (await r.rows<{ id: string }>('knowledge_resources')).map((row) => row.id);

beforeEach(async () => {
  server = await createServerStandIn();
  alice = await createReplica('alice', TEST_USER, server.as(TEST_USER));
});

afterEach(async () => {
  await alice.close();
  await server.close();
});

describe('server rows are parsed at the transport', () => {
  it('refuses a malformed row on its own: the rest of the page lands and the cursor moves past it', async () => {
    await seedNode(GOOD, 'Fine');
    await seedNode(BROKEN, 'Broken');
    const [newest] = await server.sql<{ at: Date }>(
      'select max(updated_at) as at from knowledge_resources'
    );

    const outcome = await alice.sync.pull(SPACE);

    expect(outcome.applied).toBe(1);
    expect(await localIds(alice)).toEqual([GOOD]);
    expect(outcome.refused).toHaveLength(1);
    expect(outcome.refused[0]).toMatchObject({
      table: 'knowledge_resources',
      id: BROKEN,
    });
    expect(outcome.refused[0]?.error).toBeInstanceOf(MalformedServerRowError);
    expect(String(outcome.refused[0]?.error.message)).toContain(
      `knowledge_resources.id "${BROKEN}"`
    );
    const cursor = await alice.replica.cursorFor(SPACE, 'knowledge_resources');
    // The cursor is handed back already backed off by the overlap window.
    expect(cursor!.getTime() + 5_000).toBe(new Date(newest!.at).getTime());
  });

  it('reports a refused row once, however many passes meet it again', async () => {
    await seedNode(BROKEN, 'Broken');
    expect((await alice.sync.pull(SPACE)).refused).toHaveLength(1);
    expect((await alice.sync.pull(SPACE)).refused).toEqual([]);
    expect((await alice.sync.pull(SPACE, { sweep: true })).refused).toEqual([]);
    await seedNode(GOOD, 'Fine');
    const later = await alice.sync.pull(SPACE);
    expect(later.refused).toEqual([]);
    expect(await localIds(alice)).toEqual([GOOD]);
  });

  it('refuses an id of another kind in a column of this kind', async () => {
    await seedNode('kne_0000000000000009.0000000000', 'Wrong kind');

    const outcome = await alice.sync.pull(SPACE);
    expect(outcome.refused).toHaveLength(1);
    expect(outcome.refused[0]?.error.column).toBe('id');
    expect(await localIds(alice)).toEqual([]);
  });

  it('leaves a malformed id out of an inventory and out of a targeted re-pull', async () => {
    await seedNode(GOOD, 'Fine');
    await seedNode('knr_not-an-id', 'Broken');
    const transport = server.as(TEST_USER);

    await expect(
      transport.inventory('knowledge_resources', SPACE)
    ).resolves.toEqual([GOOD]);
    const targeted = await transport.pullByNodes('knowledge_resources', SPACE, [
      knowledgeResourceIdFactory.brand(GOOD),
      knowledgeResourceIdFactory.brand('knr_not-an-id'),
    ]);
    expect(targeted.rows.map((row) => row.id)).toEqual([GOOD]);
    expect(targeted.refused.map((row) => row.id)).toEqual(['knr_not-an-id']);
  });

  it('applies well-formed rows as before', async () => {
    await seedNode(GOOD, 'Fine');
    const outcome = await alice.sync.pull(SPACE);
    expect(outcome.applied).toBe(1);
    expect(
      (await alice.rows<{ id: string }>('knowledge_resources')).map((r) => r.id)
    ).toEqual([GOOD]);
  });

  it('keeps an unrelated user out of the check (the fence still decides)', async () => {
    const bob = await createReplica('bob', OTHER_USER, server.as(OTHER_USER));
    await seedNode(GOOD, 'Fine');
    await expect(bob.sync.pull(SPACE)).resolves.toMatchObject({ applied: 1 });
    await bob.close();
  });
});

describe('the production transport parses the same way', () => {
  function clientAnswering(data: unknown[]) {
    const answer = { data, error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'order', 'range', 'gte', 'in', 'or'])
      chain[method] = () => chain;
    chain['then'] = (resolve: (a: typeof answer) => void) => resolve(answer);
    const client = { from: () => chain, schema: () => client };
    return createSupabaseGraphRowTransport(
      client as unknown as Parameters<typeof createSupabaseGraphRowTransport>[0]
    );
  }

  it('refuses a malformed row from PostgREST and keeps the others', async () => {
    const transport = clientAnswering([
      { id: GOOD, space_id: SPACE },
      { id: 'knr_0000000000000002.0000000000', space_id: 'spc_x' },
    ]);
    const page = await transport.pullSince(
      'knowledge_resources',
      SPACE,
      null,
      10,
      0
    );
    expect(page.rows.map((row) => row.id)).toEqual([GOOD]);
    expect(page.refused).toHaveLength(1);
    expect(String(page.refused[0]?.error.message)).toMatch(
      /knowledge_resources\.space_id "spc_x"/
    );
  });

  it('hands back canonical ids', async () => {
    const transport = clientAnswering([
      {
        id: 'knr_000000000000000A.0000000000',
        space_id: SPACE,
        from_id: GOOD,
      },
    ]);
    const page = await transport.pullSince(
      'knowledge_resources',
      SPACE,
      null,
      10,
      0
    );
    expect(page.rows[0]?.id).toBe('knr_000000000000000a.0000000000');
  });

  it('types its parameters as ids of their kind', () => {
    const transport = clientAnswering([]);
    // @ts-expect-error a plain string is not a space id
    void transport.inventory('knowledge_resources', 'spc_x');
    const space: SpaceId = SPACE;
    void transport.inventory('knowledge_resources', space);
  });
});
