import { entityIdRegistry } from '@workspace/entity-id';
import { TEST_USER } from '@workspace/persistence-pglite/testing/graph';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Replica } from './testing/replica.js';
import { createReplica } from './testing/replica.js';
import type { ServerStandIn } from './testing/server-stand-in.js';
import { createServerStandIn, mintId } from './testing/server-stand-in.js';
import type { GraphRowTransport } from './types.js';

/**
 * A pull applies the replicated tables one after another, each batch in its
 * own transaction, and the file tree is a live query over nodes joined to
 * their containment edge. So the order matters for what the tree shows
 * BETWEEN two tables: a node whose edge has not landed yet has no parent and
 * is drawn at the top level, and jumps into its folder a moment later. The
 * tree starts from nodes, so an edge without its node shows nothing: edges
 * before nodes, and a node arrives already in its place.
 */

const SPACE = entityIdRegistry.factories.spaceIdFactory.brand(
  'spc_0000000000000001.0000000000'
);
const FOLDER = 'knr_0000000000000001.0000000000';
const DOC = 'knr_0000000000000002.0000000000';

let server: ServerStandIn;
let alice: Replica | null = null;

beforeEach(async () => {
  server = await createServerStandIn();
  await server.sql(
    `insert into knowledge_resources
       (id, space_id, kind, title, status, visibility, created_by, owner_user_id)
     values ($1, $2, 'folder', 'Second', 'draft', 'space', $3, $3),
            ($4, $2, 'text', 'Hello', 'draft', 'space', $3, $3)`,
    [FOLDER, SPACE, TEST_USER, DOC]
  );
  await server.sql(
    `insert into knowledge_edges
       (id, space_id, from_id, to_id, relation_type, position, created_by)
     values ($1, $2, $3, $4, 'contains', 0, $5)`,
    [mintId('knowledge_edges'), SPACE, FOLDER, DOC, TEST_USER]
  );
});
afterEach(async () => {
  await alice?.close();
  alice = null;
  await server.close();
});

/**
 * What the tree would show for the document: not there, in its folder (the
 * folder is there and the containment edge points at it), or orphaned at
 * the top level (the node is there, its place is not).
 */
type Frame = 'absent' | 'in-folder' | 'top-level';

async function frameOf(replica: Replica): Promise<Frame> {
  const nodes = await replica.rows<{ id: string }>(
    'knowledge_resources',
    'id = $1 and deleted_at is null',
    [DOC]
  );
  if (nodes.length === 0) return 'absent';
  const folders = await replica.rows<{ id: string }>(
    'knowledge_resources',
    'id = $1 and deleted_at is null',
    [FOLDER]
  );
  const edges = await replica.rows<{ from_id: string }>(
    'knowledge_edges',
    "to_id = $1 and relation_type = 'contains'",
    [DOC]
  );
  return folders.length > 0 && edges.some((e) => e.from_id === FOLDER)
    ? 'in-folder'
    : 'top-level';
}

/**
 * A transport that looks at the replica right before every call that
 * changes it — before each table's pull and before each table's inventory
 * sweep — which is exactly when a live query re-renders in between.
 */
function observing(
  base: GraphRowTransport,
  target: () => Replica | null,
  frames: Frame[]
): GraphRowTransport {
  const look = async () => {
    const replica = target();
    if (replica) frames.push(await frameOf(replica));
  };
  return {
    ...base,
    async pullSince(...args) {
      await look();
      return base.pullSince(...args);
    },
    async inventory(...args) {
      await look();
      return base.inventory(...args);
    },
  };
}

describe('the order a pull applies the tables in', () => {
  it('never lets the tree see a node without the folder the server holds it in', async () => {
    const frames: Frame[] = [];
    alice = await createReplica(
      'alice',
      TEST_USER,
      observing(server.as(TEST_USER), () => alice, frames)
    );

    await alice.sync.pull(SPACE);

    expect(await frameOf(alice)).toBe('in-folder');
    expect(frames).not.toContain('top-level');
  });

  it('never lets the tree see a node outside its folder while both are leaving', async () => {
    const frames: Frame[] = [];
    alice = await createReplica(
      'alice',
      TEST_USER,
      observing(server.as(TEST_USER), () => alice, frames)
    );
    await alice.sync.pull(SPACE);
    expect(await frameOf(alice)).toBe('in-folder');

    // The document and its place are gone from the server: nothing a
    // watermark scan would report, only the inventory sweep notices.
    await server.sql('delete from knowledge_edges where to_id = $1', [DOC]);
    await server.sql('delete from knowledge_resources where id = $1', [DOC]);
    frames.length = 0;

    await alice.sync.pull(SPACE, { sweep: true });

    expect(await frameOf(alice)).toBe('absent');
    expect(frames).not.toContain('top-level');
  });

  it('a node that becomes visible during a pull, through the edge another device just wrote, arrives in its folder or not at all', async () => {
    // Another device files a document into the shared folder: two writes,
    // the node and then its containment edge. Here they land between the
    // first and the second read of one pull. A node read after the edges
    // would arrive without them and be drawn at the top level until the
    // next pass; read before them, it either is not there yet or its edge
    // is read after it.
    const LATE = 'knr_0000000000000003.0000000000';
    await server.sql('delete from knowledge_edges where to_id = $1', [DOC]);
    await server.sql('delete from knowledge_resources where id = $1', [DOC]);
    const base = server.as(TEST_USER);
    let reads = 0;
    const racing: GraphRowTransport = {
      ...base,
      async pullSince(...args) {
        const page = await base.pullSince(...args);
        reads += 1;
        if (reads === 1) {
          await server.sql(
            `insert into knowledge_resources
               (id, space_id, kind, title, status, visibility, created_by, owner_user_id)
             values ($1, $2, 'text', 'Late', 'draft', 'space', $3, $3)`,
            [LATE, SPACE, TEST_USER]
          );
          await server.sql(
            `insert into knowledge_edges
               (id, space_id, from_id, to_id, relation_type, position, created_by)
             values ($1, $2, $3, $4, 'contains', 0, $5)`,
            [mintId('knowledge_edges'), SPACE, FOLDER, LATE, TEST_USER]
          );
        }
        return page;
      },
    };
    alice = await createReplica('alice', TEST_USER, racing);

    await alice.sync.pull(SPACE);

    const late = await alice.rows('knowledge_resources', 'id = $1', [LATE]);
    const placed = await alice.rows<{ from_id: string }>(
      'knowledge_edges',
      "to_id = $1 and relation_type = 'contains'",
      [LATE]
    );
    // Never a node without the place the server held it in when it was read.
    expect(late.length === 0 || placed.some((e) => e.from_id === FOLDER)).toBe(
      true
    );

    await alice.sync.pull(SPACE);
    expect(
      await alice.rows('knowledge_resources', 'id = $1', [LATE])
    ).toHaveLength(1);
  });
});
