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
 * kind its column holds, or the row is refused with an error that names it
 * and nothing of its page is applied. Inside the engine they are typed ids
 * from then on.
 */

const { knowledgeResourceIdFactory, spaceIdFactory } =
  entityIdRegistry.factories;

const SPACE = spaceIdFactory.brand('spc_0000000000000001.0000000000');
const GOOD = 'knr_0000000000000001.0000000000';

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

beforeEach(async () => {
  server = await createServerStandIn();
  alice = await createReplica('alice', TEST_USER, server.as(TEST_USER));
});

afterEach(async () => {
  await alice.close();
  await server.close();
});

describe('server rows are parsed at the transport', () => {
  it('refuses a page holding a malformed id, names it, and applies none of it', async () => {
    await seedNode(GOOD, 'Fine');
    await seedNode("knr_' OR 1=1--", 'Broken');

    const failure = await alice.sync.pull(SPACE).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(MalformedServerRowError);
    expect(String((failure as Error).message)).toContain(
      `knowledge_resources.id "knr_' OR 1=1--"`
    );
    expect(await alice.rows('knowledge_resources')).toEqual([]);
  });

  it('refuses an id of another kind in a column of this kind', async () => {
    await seedNode('kne_0000000000000009.0000000000', 'Wrong kind');

    await expect(alice.sync.pull(SPACE)).rejects.toBeInstanceOf(
      MalformedServerRowError
    );
    expect(await alice.rows('knowledge_resources')).toEqual([]);
  });

  it('refuses a malformed id in an inventory and in a targeted re-pull', async () => {
    await seedNode('knr_not-an-id', 'Broken');
    const transport = server.as(TEST_USER);

    await expect(
      transport.inventory('knowledge_resources', SPACE)
    ).rejects.toBeInstanceOf(MalformedServerRowError);
    await expect(
      transport.pullByNodes('knowledge_resources', SPACE, [
        knowledgeResourceIdFactory.brand('knr_not-an-id'),
      ])
    ).rejects.toBeInstanceOf(MalformedServerRowError);
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

  it('refuses a malformed row from PostgREST', async () => {
    const transport = clientAnswering([
      { id: 'knr_0000000000000001.0000000000', space_id: 'spc_x' },
    ]);
    await expect(
      transport.pullSince('knowledge_resources', SPACE, null, 10, 0)
    ).rejects.toThrow(/knowledge_resources\.space_id "spc_x"/);
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
