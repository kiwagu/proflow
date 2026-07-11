/**
 * Resolve-transport security acceptance test — P0 finding #1 (2026-06-17 review).
 *
 * The projection resolve transport `resolve_projection_query(p_sql, p_params)` is
 * `grant execute … to authenticated` and EXECUTEs caller-supplied `p_sql` behind a
 * single `like 'with recursive%'` prefix guard. That guard does NOT stop
 * data-modifying CTEs, so ANY authenticated user can call the RPC directly via
 * PostgREST and run arbitrary read/write SQL bounded only by table RLS — bypassing
 * the TS compiler, its field/operator allow-list and the projection contract.
 *
 * This test encodes the REQUIRED OUTCOME of the fix (transport redesign tracked by
 * a knowledge-architect ADR): an authenticated user must have NO arbitrary-SQL
 * execution path. Concretely:
 *   (A) `authenticated` cannot call `resolve_projection_query` with a hand-rolled,
 *       data-modifying recursive CTE (no DML lands).
 *   (B) legitimate projection resolves under the user's RLS still work (the
 *       resolver, going through whatever the sanctioned transport becomes, keeps
 *       returning the same rows for a granted user and an empty set for an
 *       ungranted user).
 *
 * It is RED against the current `security invoker` + `grant authenticated` RPC and
 * turns GREEN once the transport no longer exposes raw SQL to PostgREST (REVOKE +
 * server-side execution under the user's JWT, or a structured `projection_id`
 * RPC). Tagged `@full` — needs the running Supabase stack.
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

test.describe('knowledge resolve transport — no authenticated arbitrary SQL @full', () => {
  test.describe.configure({ timeout: 90_000 });

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

  // P0 acceptance (ratified 2026-06-17). The exploitable transport
  // (`resolve_projection_query`, `security invoker`, `grant execute to
  // authenticated`) is now DROPPED/REVOKED: the compiled resolve runs server-side
  // under the user's RLS over a dedicated non-bypass-RLS connection, never as a
  // PostgREST-callable raw-SQL RPC. This test (active) proves the hole is closed.
  test('(A) an authenticated user cannot run a data-modifying CTE through the transport', async () => {
    // A granted authenticated user crafts a recursive CTE that DELETEs the graph
    // it can otherwise only read-project. It passes the `with recursive%` prefix
    // guard, so the legacy RPC would execute the DELETE under the caller's RLS.
    const lessonId = graph.lessonIds[0];
    const maliciousSql = [
      'with recursive pwn as (',
      `  delete from public.knowledge_resources where id = '${lessonId}' returning id`,
      ')',
      "select id, 'text'::text as kind, 'x'::text as title, 'active'::text as status,",
      "  'space'::text as visibility, null::jsonb as body_ref, 0 as depth,",
      '  null::text as via_edge_id',
      'from pwn',
    ].join('\n');

    // Direct PostgREST RPC call as the authenticated user — the exploit surface.
    const { error } = await tenant.granted.client.rpc(
      // cast: the RPC must no longer be callable with raw SQL once fixed.
      'resolve_projection_query' as never,
      { p_sql: maliciousSql, p_params: [] } as never
    );

    // After the fix the RPC is not PostgREST-callable (revoked / removed), so the
    // call MUST error out rather than silently executing the DELETE.
    expect(error).not.toBeNull();

    // And regardless of the call's outcome, the node MUST still exist: no DML may
    // have landed. Verified with the service client (bypasses RLS).
    const { data, error: readErr } = await tenant.service
      .from('knowledge_resources')
      .select('id')
      .eq('id', lessonId)
      .maybeSingle();
    expect(readErr).toBeNull();
    expect(data?.id).toBe(lessonId);
  });

  test('(B) legitimate resolves still work for granted users and stay empty for ungranted', async () => {
    const granted = await resolveProjection(kbSpec(graph.tagNodeId), {
      projectionId: graph.knowledgeBaseProjectionId,
      spaceId: tenant.spaceId,
      db: tenant.granted.client,
      transport: await transportForActor(tenant.granted.client),
    });
    expect(new Set(granted.items.map((i) => i.id))).toEqual(
      new Set(graph.taggedLessonIds)
    );

    const ungranted = await resolveProjection(kbSpec(graph.tagNodeId), {
      projectionId: graph.knowledgeBaseProjectionId,
      spaceId: tenant.spaceId,
      db: tenant.ungranted.client,
      transport: await transportForActor(tenant.ungranted.client),
    });
    expect(ungranted.items).toEqual([]);
  });
});
