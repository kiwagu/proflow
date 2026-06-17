/**
 * Projection-engine acceptance test — slice 02 (docs/knowledge-graph-plan.md §4–5).
 *
 * Proves the execution-level invariant: KB and course resolve over the IDENTICAL
 * knowledge_resources / knowledge_edges set — a projection, not a fork. The
 * engine (`@workspace/knowledge-engine`) compiles each saved ProjectionSpec into
 * ONE parameterized recursive-CTE query and runs it under the caller's RLS
 * session (via the SECURITY INVOKER `resolve_projection_query` RPC), so it can
 * only narrow what RLS allows — never widen.
 *
 * Variant B: a tag is a graph node (`kind='tag'`) and "has tag T" is an INCOMING
 * `tagged` traversal from T, not a filter field. KB = resources reachable via
 * `tagged` from the KB tag AND `kind in (text, link)`. Course = an OUTGOING
 * `prerequisite` walk, ordered.
 *
 * The demo graph lives in the e2e harness, never a migration (hardcoded-id domain
 * rows would poison identity-sync); only the `tag`/`tagged` vocabulary rows are
 * data in a migration.
 */
import {
  parseProjectionSpec,
  type ProjectionSpec,
} from '@workspace/knowledge-contracts';
import { resolveProjection } from '@workspace/knowledge-engine';
import { expect, test } from '@playwright/test';

import {
  bootstrapKnowledgeGraphTenant,
  seedProjectionEngineDemo,
  teardownKnowledgeGraphTenant,
  type KnowledgeGraphTenant,
  type ProjectionEngineGraph,
} from './helpers/knowledge-graph-bootstrap.js';
import {
  closeResolveTransportPool,
  transportForActor,
} from './helpers/projection-resolve-transport.js';

function kbSpec(tagNodeId: string): ProjectionSpec {
  const parsed = parseProjectionSpec({
    schema_version: 1,
    filter: { field: 'kind', op: 'in', value: ['text', 'link'] },
    traversal: {
      start: { ids: [tagNodeId] },
      relation_types: ['tagged'],
      direction: 'incoming',
      max_depth: 1,
      order_by: 'position',
    },
    view: 'grid',
  });
  if (!parsed.success) throw new Error('kbSpec parse failed');
  return parsed.data;
}

function courseSpec(maxDepth = 16): ProjectionSpec {
  const parsed = parseProjectionSpec({
    schema_version: 1,
    filter: { field: 'status', op: 'eq', value: 'active' },
    traversal: {
      start: { filter: { field: 'kind', op: 'eq', value: 'text' } },
      relation_types: ['prerequisite'],
      direction: 'outgoing',
      max_depth: maxDepth,
      order_by: 'position',
    },
    view: 'course',
  });
  if (!parsed.success) throw new Error('courseSpec parse failed');
  return parsed.data;
}

// Single-root prerequisite walk (start at one lesson) — used for the depth-cap
// scenario so the cap is observable along one chain rather than every text node
// also being a depth-0 start.
function chainSpec(startId: string, maxDepth: number): ProjectionSpec {
  const parsed = parseProjectionSpec({
    schema_version: 1,
    filter: { field: 'status', op: 'eq', value: 'active' },
    traversal: {
      start: { ids: [startId] },
      relation_types: ['prerequisite'],
      direction: 'outgoing',
      max_depth: maxDepth,
      order_by: 'position',
    },
    view: 'course',
  });
  if (!parsed.success) throw new Error('chainSpec parse failed');
  return parsed.data;
}

test.describe('knowledge graph — projection engine (KB + course over one graph) @full', () => {
  test.describe.configure({ timeout: 60_000 });

  let tenant: KnowledgeGraphTenant;
  let graph: ProjectionEngineGraph;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
    graph = await seedProjectionEngineDemo(tenant);
  });

  test.afterAll(async () => {
    if (tenant) {
      await teardownKnowledgeGraphTenant(tenant);
    }
    await closeResolveTransportPool();
  });

  test('(1) KB projection resolves the tagged set via incoming `tagged` traversal', async () => {
    const result = await resolveProjection(kbSpec(graph.tagNodeId), {
      projectionId: graph.knowledgeBaseProjectionId,
      spaceId: tenant.spaceId,
      db: tenant.granted.client,
      transport: await transportForActor(tenant.granted.client),
    });

    expect(result.view).toBe('grid');
    expect(result.projection_id).toBe(graph.knowledgeBaseProjectionId);

    const ids = new Set(result.items.map((i) => i.id));
    // Exactly the tagged lessons (L1, L2) — L3 is untagged, the tag node itself
    // is not kind in (text, link), so neither appears.
    expect(ids).toEqual(new Set(graph.taggedLessonIds));
    expect(ids.has(graph.lessonIds[2])).toBe(false);
    expect(ids.has(graph.tagNodeId)).toBe(false);
    // arrived through a `tagged` edge (depth 1, via_edge_id set)
    for (const item of result.items) {
      expect(item.depth).toBe(1);
      expect(item.via_edge_id).not.toBeNull();
    }
  });

  test('(2) course projection resolves the prerequisite ORDER over the SAME graph', async () => {
    const result = await resolveProjection(courseSpec(), {
      projectionId: graph.courseProjectionId,
      spaceId: tenant.spaceId,
      db: tenant.granted.client,
      transport: await transportForActor(tenant.granted.client),
    });

    expect(result.view).toBe('course');

    // The lessons in prerequisite order L1 → L2 → L3 (the tag node is kind='tag',
    // never a start node for the course's kind=text start filter).
    const ids = result.items.map((i) => i.id);
    expect(ids).toEqual([
      graph.lessonIds[0],
      graph.lessonIds[1],
      graph.lessonIds[2],
    ]);

    const byId = new Map(result.items.map((i) => [i.id, i]));
    // depth 0/1/2 along the chain; via_edge_id null only for the start node.
    expect(byId.get(graph.lessonIds[0])?.depth).toBe(0);
    expect(byId.get(graph.lessonIds[1])?.depth).toBe(1);
    expect(byId.get(graph.lessonIds[2])?.depth).toBe(2);
    expect(byId.get(graph.lessonIds[0])?.via_edge_id).toBeNull();
    expect(byId.get(graph.lessonIds[1])?.via_edge_id).not.toBeNull();
    expect(byId.get(graph.lessonIds[2])?.via_edge_id).not.toBeNull();
  });

  test('(3) RLS: a user without space.knowledge.read gets an empty set, not an error', async () => {
    const kb = await resolveProjection(kbSpec(graph.tagNodeId), {
      projectionId: graph.knowledgeBaseProjectionId,
      spaceId: tenant.spaceId,
      db: tenant.ungranted.client,
      transport: await transportForActor(tenant.ungranted.client),
    });
    expect(kb.items).toEqual([]);

    const course = await resolveProjection(courseSpec(), {
      projectionId: graph.courseProjectionId,
      spaceId: tenant.spaceId,
      db: tenant.ungranted.client,
      transport: await transportForActor(tenant.ungranted.client),
    });
    expect(course.items).toEqual([]);
  });

  test('(4) cycle-guard: closing L3→L1 prerequisite still terminates with no dups', async () => {
    // Close a cycle L1→L2→L3→L1; the path accumulator must stop re-entry.
    const { error } = await tenant.granted.client
      .from('knowledge_edges')
      .insert({
        space_id: tenant.spaceId,
        from_id: graph.lessonIds[2],
        to_id: graph.lessonIds[0],
        relation_type: 'prerequisite',
        position: 2,
        created_by: tenant.granted.userId,
      });
    expect(error).toBeNull();

    const result = await resolveProjection(courseSpec(), {
      projectionId: graph.courseProjectionId,
      spaceId: tenant.spaceId,
      db: tenant.granted.client,
      transport: await transportForActor(tenant.granted.client),
    });

    // Terminates, and each node appears exactly once despite the cycle.
    const ids = result.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(new Set(graph.lessonIds));

    // Cleanup the cycle edge so the depth-cap test starts from the chain.
    await tenant.service
      .from('knowledge_edges')
      .delete()
      .eq('space_id', tenant.spaceId)
      .eq('from_id', graph.lessonIds[2])
      .eq('to_id', graph.lessonIds[0])
      .eq('relation_type', 'prerequisite');
  });

  test('(5) depth-cap: a chain longer than max_depth stops at the cap', async () => {
    // Start at L1 only, cap depth at 1: L1 (depth 0) + L2 (depth 1) survive; L3
    // (depth 2) is beyond the cap and excluded.
    const result = await resolveProjection(chainSpec(graph.lessonIds[0], 1), {
      projectionId: graph.courseProjectionId,
      spaceId: tenant.spaceId,
      db: tenant.granted.client,
      transport: await transportForActor(tenant.granted.client),
    });

    const maxDepth = Math.max(...result.items.map((i) => i.depth));
    expect(maxDepth).toBe(1);
    const ids = new Set(result.items.map((i) => i.id));
    expect(ids).toEqual(new Set([graph.lessonIds[0], graph.lessonIds[1]]));
    expect(ids.has(graph.lessonIds[2])).toBe(false);
  });
});
