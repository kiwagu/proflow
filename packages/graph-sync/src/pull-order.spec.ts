import { TEST_USER } from '@workspace/persistence-pglite/testing/graph';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Replica } from './testing/replica.js';
import { createReplica } from './testing/replica.js';
import type { ServerStandIn } from './testing/server-stand-in.js';
import { createServerStandIn, mintId } from './testing/server-stand-in.js';
import type { GraphSyncTableName } from './tables.js';
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

const SPACE = 'spc_0000000000000001.0000000000';
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

/** What the tree would show for the document: absent, in its folder, or orphaned at the top. */
type Frame = 'absent' | 'in-folder' | 'top-level';

async function frameOf(replica: Replica): Promise<Frame> {
  const nodes = await replica.rows<{ id: string }>(
    'knowledge_resources',
    'id = $1',
    [DOC]
  );
  if (nodes.length === 0) return 'absent';
  const edges = await replica.rows<{ from_id: string }>(
    'knowledge_edges',
    "to_id = $1 and relation_type = 'contains'",
    [DOC]
  );
  return edges.length > 0 ? 'in-folder' : 'top-level';
}

describe('the order a pull applies the tables in', () => {
  it('never lets the tree see a node without the folder the server holds it in', async () => {
    const base = server.as(TEST_USER);
    const frames: Array<{ before: GraphSyncTableName; frame: Frame }> = [];
    // Between two tables is exactly when a live query re-renders: look at the
    // replica right before each table's pull, as the tree would.
    const observed: GraphRowTransport = {
      ...base,
      async pullSince(table, ...rest) {
        if (alice) frames.push({ before: table, frame: await frameOf(alice) });
        return base.pullSince(table, ...rest);
      },
    };
    alice = await createReplica('alice', TEST_USER, observed);

    await alice.sync.pull(SPACE);

    expect(await frameOf(alice)).toBe('in-folder');
    expect(frames.map((f) => f.frame)).not.toContain('top-level');
  });
});
