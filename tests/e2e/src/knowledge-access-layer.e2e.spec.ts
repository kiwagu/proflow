/**
 * Access-layer acceptance test — slice 07 (docs/knowledge-graph-plan.md §5).
 *
 * Proves the HARD-ACCESS (RLS) generalization: cohort (additive members-only GRANT
 * via `scopes`) + manager → subordinate hierarchy compose over node visibility by the
 * formula `is_owner OR (base AND (floor published OR cohort grant)) OR
 * hierarchy`. A node not admitted by any branch is HIDDEN — ABSENT from
 * `ProjectionResult.items`, never
 * present with `available=false`. This is the carrying boundary authorization ≠
 * gating: contrast slice-05/06 where a closed node stays in
 * `items` with a display flag.
 *
 * The resolver is `security invoker`, so swapping the knowledge_resources SELECT
 * policy onto the composing helper hides nodes natively across every projection —
 * ZERO resolver/engine/contract changes. The demo (cohort scope + memberships +
 * resource→scope links + a reporting-line chain + subordinate-owned nodes) lives
 * entirely in the harness (the identity-sync lesson), never a migration.
 *
 * Coverage maps to slice-07 §6:
 *  (1) cohort hides (RLS hard): member sees the restricted node; stranger → ABSENT.
 *  (2) published nodes (floor='space') unaffected — both members and strangers see them.
 *  (3) hierarchy: manager sees subordinate-owned; peer does NOT; transitivity
 *      (manager-of-manager) also sees via recursion.
 *  (4) space isolation: a manager does NOT see a subordinate-owned node in ANOTHER
 *      space (auth_user_manages_owner checks space inside).
 *  (5) composition (floor=private + cohort + hierarchy): a node both scope-granted and
 *      subordinate-owned — manager (not cohort member) still sees via hierarchy;
 *      cohort member (not manager) sees via scope; stranger sees neither.
 *  (6) authz ≠ gating boundary: a hidden node is ABSENT from `items` (not a flag);
 *      cohort/hierarchy are NOT in GATING_RULE_REGISTRY; the resolver is unchanged.
 *
 * Tagged `@full` — needs the running Supabase stack.
 */
import {
  parseProjectionSpec,
  type ProjectionSpec,
} from '@workspace/knowledge-contracts';
import {
  GATING_RULE_REGISTRY,
  resolveProjection,
} from '@workspace/knowledge-engine';
import { type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import {
  bootstrapAccessLayerActors,
  bootstrapKnowledgeGraphTenant,
  seedAccessLayerDemo,
  teardownKnowledgeGraphTenant,
  type AccessLayerActors,
  type AccessLayerGraph,
  type KnowledgeGraphTenant,
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

test.describe('knowledge access layer (cohort + hierarchy RLS dimensions) @full', () => {
  test.describe.configure({ timeout: 180_000 });

  let tenant: KnowledgeGraphTenant;
  let actors: AccessLayerActors;
  let graph: AccessLayerGraph;

  /** Resolve the demo KB projection AS the given RLS client → the visible id set. */
  async function visibleIds(db: SupabaseClient): Promise<Set<string>> {
    const result = await resolveProjection(kbSpec(graph.tagNodeId), {
      projectionId: graph.projectionId,
      spaceId: tenant.spaceId,
      db,
      transport: await transportForActor(db),
    });
    return new Set(result.items.map((i) => i.id));
  }

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
    actors = await bootstrapAccessLayerActors(tenant);
    graph = await seedAccessLayerDemo(tenant, actors);
  });

  test.afterAll(async () => {
    if (tenant) {
      await teardownKnowledgeGraphTenant(tenant, actors?.extraUserIds ?? []);
    }
    await closeResolveTransportPool();
  });

  test('(1) cohort hides (RLS hard): member sees it, stranger → absent', async () => {
    const memberIds = await visibleIds(actors.cohortMember.client);
    const strangerIds = await visibleIds(actors.cohortStranger.client);

    // Member of scope-A sees the cohort-restricted node.
    expect(memberIds.has(graph.cohortRestrictedNodeId)).toBe(true);
    // Stranger: the node is ABSENT from items (hidden, not flagged).
    expect(strangerIds.has(graph.cohortRestrictedNodeId)).toBe(false);
  });

  test('(2) published nodes (floor=space) are visible to all space members', async () => {
    const memberIds = await visibleIds(actors.cohortMember.client);
    const strangerIds = await visibleIds(actors.cohortStranger.client);

    // No scope link → visible to BOTH the cohort member and the stranger.
    expect(memberIds.has(graph.unrestrictedNodeId)).toBe(true);
    expect(strangerIds.has(graph.unrestrictedNodeId)).toBe(true);
  });

  test('(3) hierarchy: manager sees subordinate-owned; peer does not; transitive', async () => {
    const managerIds = await visibleIds(actors.manager.client);
    const peerIds = await visibleIds(actors.peer.client);
    const mgr2Ids = await visibleIds(actors.managerOfManager.client);

    // The hierarchy node is owned by `subordinate` and NOT scope-restricted, so
    // only a (transitive) manager sees it via the hierarchy branch.
    expect(managerIds.has(graph.hierarchyNodeId)).toBe(true);
    // A peer (no reporting line) → node absent.
    expect(peerIds.has(graph.hierarchyNodeId)).toBe(false);
    // Transitivity: manager-of-manager → subordinate, via the recursive closure.
    expect(mgr2Ids.has(graph.hierarchyNodeId)).toBe(true);
  });

  test('(4) space isolation holds in the hierarchy branch (no cross-space leak)', async () => {
    // A second, fully isolated tenant. The manager from tenant A is NOT a member
    // of tenant B and has no reporting line there. Even though the manager
    // manages `subordinate` in tenant A, `auth_user_manages_owner` checks space
    // membership INSIDE the predicate, so a subordinate-owned node in tenant B
    // must NOT surface to the tenant-A manager.
    const tenantB = await bootstrapKnowledgeGraphTenant();
    try {
      const actorsB = await bootstrapAccessLayerActors(tenantB);
      const graphB = await seedAccessLayerDemo(tenantB, actorsB);

      const result = await resolveProjection(kbSpec(graphB.tagNodeId), {
        projectionId: graphB.projectionId,
        spaceId: tenantB.spaceId,
        // tenant-A manager's RLS client probing tenant B.
        db: actors.manager.client,
        transport: await transportForActor(actors.manager.client),
      });
      // Not a member of tenant B at all → empty set, and certainly no
      // subordinate-owned node leaks across the space boundary.
      expect(result.items.map((i) => i.id)).not.toContain(
        graphB.hierarchyNodeId
      );
      expect(result.items).toEqual([]);

      await teardownKnowledgeGraphTenant(tenantB, actorsB.extraUserIds);
    } catch (err) {
      await teardownKnowledgeGraphTenant(tenantB);
      throw err;
    }
  });

  test('(5) composition: (base AND scope) OR hierarchy', async () => {
    const managerIds = await visibleIds(actors.manager.client);
    const memberIds = await visibleIds(actors.cohortMember.client);
    const strangerIds = await visibleIds(actors.cohortStranger.client);

    // The composed node is BOTH scope-A-restricted AND owned by `subordinate`.
    // manager: NOT a cohort member, but sees it via the hierarchy OR-branch.
    expect(managerIds.has(graph.composedNodeId)).toBe(true);
    // cohort member: NOT a manager, but sees it via the cohort branch.
    expect(memberIds.has(graph.composedNodeId)).toBe(true);
    // stranger: neither member nor manager → absent (both branches fail).
    expect(strangerIds.has(graph.composedNodeId)).toBe(false);
  });

  test('(7) edge SELECT does not leak a cohort-hidden endpoint (finding #2)', async () => {
    // The `tagged` edge cohortRestrictedNodeId → tagNodeId touches a node the
    // stranger may NOT see (cohort-fenced). Before the fix the edge was readable
    // on plain space.knowledge.read, leaking the hidden node id via from_id (plus
    // relation_type/metadata/neighbour). After the fix an edge is visible only
    // when BOTH endpoints are access-visible, so the stranger sees no such edge.
    const { data: strangerEdges, error: strangerErr } =
      await actors.cohortStranger.client
        .from('knowledge_edges')
        .select('id,from_id,to_id,relation_type,metadata')
        .eq('from_id', graph.cohortRestrictedNodeId);
    expect(strangerErr).toBeNull();
    expect(strangerEdges ?? []).toEqual([]);

    // The cohort MEMBER (who can see both endpoints) still reads the edge — the
    // tightening hides leaks without breaking legitimate edge visibility.
    const { data: memberEdges, error: memberErr } =
      await actors.cohortMember.client
        .from('knowledge_edges')
        .select('id,from_id')
        .eq('from_id', graph.cohortRestrictedNodeId);
    expect(memberErr).toBeNull();
    expect((memberEdges ?? []).length).toBeGreaterThan(0);
  });

  test('(8) resource_scopes SELECT does not leak cohort fencing of a hidden node (finding #3)', async () => {
    // The link row (cohortRestrictedNodeId, scopeAId) records that a node the
    // stranger cannot see is cohort-fenced. Gating the link SELECT on the
    // resource's OWN access (not base read) means the stranger cannot enumerate
    // it: a caller who cannot see the resource cannot learn it is scope-fenced.
    const { data: strangerLinks, error: strangerErr } =
      await actors.cohortStranger.client
        .from('knowledge_resource_scopes')
        .select('resource_id,scope_id')
        .eq('resource_id', graph.cohortRestrictedNodeId);
    expect(strangerErr).toBeNull();
    expect(strangerLinks ?? []).toEqual([]);

    // The cohort member (who can access the resource) still reads its scope link.
    const { data: memberLinks, error: memberErr } =
      await actors.cohortMember.client
        .from('knowledge_resource_scopes')
        .select('resource_id,scope_id')
        .eq('resource_id', graph.cohortRestrictedNodeId);
    expect(memberErr).toBeNull();
    expect((memberLinks ?? []).length).toBeGreaterThan(0);
  });

  test('(6) authz ≠ gating: hidden node absent from items; not a gating rule', async () => {
    const strangerIds = await visibleIds(actors.cohortStranger.client);

    // Hidden by cohort → ABSENT from items (no `available=false` placeholder).
    expect(strangerIds.has(graph.cohortRestrictedNodeId)).toBe(false);
    expect(strangerIds.has(graph.composedNodeId)).toBe(false);

    // The cohort/hierarchy dimensions are L1 access (RLS), never display gating:
    // they must NOT appear in the engine's gating-rule registry.
    const gatingKeys = Object.keys(GATING_RULE_REGISTRY);
    expect(gatingKeys).not.toContain('cohort');
    expect(gatingKeys).not.toContain('scope');
    expect(gatingKeys).not.toContain('hierarchy');
    expect(gatingKeys).not.toContain('reporting');
    expect(gatingKeys).not.toContain('manages');

    // The granted admin owns both the unrestricted (published) and the
    // cohort-restricted (private) demo nodes, so it sees BOTH — the latter via the
    // Model B `is_owner` branch ("you always see your own"), even though
    // it is NOT a member of the cohort that the node is shared with. (Ownership
    // trumps cohort membership; the resolver is unchanged, only RLS moved the set.)
    const grantedIds = await visibleIds(tenant.granted.client);
    expect(grantedIds.has(graph.unrestrictedNodeId)).toBe(true);
    expect(grantedIds.has(graph.cohortRestrictedNodeId)).toBe(true);
  });
});
