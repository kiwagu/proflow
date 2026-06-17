/**
 * Knowledge-graph acceptance test — Invariant #1 (docs/knowledge-graph-plan.md §6).
 *
 * Proves the generative-core claim: a SECOND app type (a course) is pure
 * configuration — `prerequisite` vocabulary edges plus ONE more `projections`
 * row over the SAME graph — and
 * requires ZERO new schema migrations. The KB-only and KB+course states differ
 * only by data, so the schema is identical between them (empty schema diff).
 *
 * This is a DB/integration test driven entirely through Supabase clients
 * (service-role for setup/teardown + actor JWTs for RLS), matching the repo's
 * e2e convention (no direct Postgres / pg_dump from the harness; the e2e `.env`
 * contract only carries Supabase URL + keys). The empty-schema-diff is asserted
 * at the data level here — both projections resolve over the identical
 * resource/edge set with no DDL for the course — and the literal schema-diff is
 * kept as a documented, repo-runnable command below for manual confirmation:
 *
 *   # KB-only vs KB+course schema diff over the six knowledge tables.
 *   # Dump the knowledge schema, insert ONLY the course projection row, dump
 *   # again, strip pg_dump's random \restrict/\unrestrict session tokens, diff.
 *   TABLES="public.resource_kinds public.relation_types public.view_types \
 *           public.knowledge_resources public.knowledge_edges public.projections"
 *   pg_dump "$DB_URL" --schema-only $(printf -- '-t %s ' $TABLES) \
 *     | grep -vE '^\\(un)?restrict ' > /tmp/kb-only.sql
 *   # ... insert one projections row (app_type=course) ...
 *   pg_dump "$DB_URL" --schema-only $(printf -- '-t %s ' $TABLES) \
 *     | grep -vE '^\\(un)?restrict ' > /tmp/kb-plus-course.sql
 *   diff /tmp/kb-only.sql /tmp/kb-plus-course.sql   # expected: empty
 */
import { expect, test } from '@playwright/test';

import {
  bootstrapKnowledgeGraphTenant,
  COURSE_SPEC,
  seedDemoGraph,
  teardownKnowledgeGraphTenant,
  type DemoGraph,
  type KnowledgeGraphTenant,
} from './helpers/knowledge-graph-bootstrap.js';

test.describe('knowledge graph — Invariant #1 (course = data, zero migration) @full', () => {
  test.describe.configure({ timeout: 60_000 });

  let tenant: KnowledgeGraphTenant;
  let graph: DemoGraph;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
    graph = await seedDemoGraph(tenant);
  });

  test.afterAll(async () => {
    if (tenant) {
      await teardownKnowledgeGraphTenant(tenant);
    }
  });

  test('both projections (knowledge_base + course) read over the SAME graph', async () => {
    const db = tenant.granted.client;

    // The single Variant-B graph: three text lessons + one `kind='tag'` node,
    // wired by two `prerequisite` edges (course) and two `tagged` edges (KB).
    const { data: resources, error: resErr } = await db
      .from('knowledge_resources')
      .select('id,kind,status')
      .eq('space_id', tenant.spaceId);
    expect(resErr).toBeNull();
    expect(resources).toHaveLength(4);
    expect(resources?.filter((r) => r.kind === 'text')).toHaveLength(3);
    expect(resources?.filter((r) => r.kind === 'tag')).toHaveLength(1);

    const { data: edges, error: edgeErr } = await db
      .from('knowledge_edges')
      .select('id,relation_type,from_id,to_id')
      .eq('space_id', tenant.spaceId);
    expect(edgeErr).toBeNull();
    expect(edges).toHaveLength(4);
    expect(new Set(edges?.map((e) => e.relation_type))).toEqual(
      new Set(['prerequisite', 'tagged'])
    );
    // Course traverses ONLY the prerequisite edges; KB ONLY the tagged edges —
    // both projections over the one shared edge set, no per-app edge type table.
    expect(
      edges?.filter((e) => e.relation_type === 'prerequisite')
    ).toHaveLength(2);
    expect(edges?.filter((e) => e.relation_type === 'tagged')).toHaveLength(2);

    // Two projections — both over that one resource/edge set.
    const { data: projections, error: prjErr } = await db
      .from('projections')
      .select('id,app_type,view,spec')
      .eq('space_id', tenant.spaceId)
      .order('app_type', { ascending: true });
    expect(prjErr).toBeNull();
    expect(projections).toHaveLength(2);

    const appTypes = projections?.map((p) => p.app_type) ?? [];
    expect(appTypes).toContain('knowledge_base');
    expect(appTypes).toContain('course');

    // The course projection IS the second app view — view=course, traversal
    // along the prerequisite edges that already exist in the shared graph.
    const course = projections?.find((p) => p.app_type === 'course');
    expect(course?.id).toBe(graph.courseProjectionId);
    expect(course?.view).toBe('course');
    const courseSpec = course?.spec as {
      traversal: { relation_types: string[] };
      view: string;
    };
    expect(courseSpec.traversal.relation_types).toEqual(['prerequisite']);
    expect(courseSpec.view).toBe('course');

    const kb = projections?.find((p) => p.app_type === 'knowledge_base');
    expect(kb?.id).toBe(graph.knowledgeBaseProjectionId);
    expect(kb?.view).toBe('grid');
  });

  test('the course is purely vocabulary + one projections row over the shared edges (empty schema diff)', async () => {
    const service = tenant.service;

    // (1) `prerequisite` is a vocabulary ROW (data), not DDL.
    const { data: relation, error: relErr } = await service
      .from('relation_types')
      .select('key')
      .eq('key', 'prerequisite')
      .single();
    expect(relErr).toBeNull();
    expect(relation?.key).toBe('prerequisite');

    // (2) `course` view is a vocabulary ROW (data), not DDL.
    const { data: view, error: viewErr } = await service
      .from('view_types')
      .select('key')
      .eq('key', 'course')
      .single();
    expect(viewErr).toBeNull();
    expect(view?.key).toBe('course');

    // (3) The course traverses the SAME prerequisite edges the KB graph holds —
    //     no course-specific edge type, table, or column was introduced.
    const { data: courseEdges, error: ceErr } = await service
      .from('knowledge_edges')
      .select('from_id,to_id')
      .eq('space_id', tenant.spaceId)
      .eq('relation_type', 'prerequisite')
      .order('position', { ascending: true });
    expect(ceErr).toBeNull();
    expect(courseEdges).toEqual([
      { from_id: graph.resourceIds[0], to_id: graph.resourceIds[1] },
      { from_id: graph.resourceIds[1], to_id: graph.resourceIds[2] },
    ]);

    // (4) Dropping the course leaves the KB graph (resources + edges) intact —
    //     i.e. the course adds NOTHING structural; it is one removable row.
    const { error: dropErr } = await service
      .from('projections')
      .delete()
      .eq('id', graph.courseProjectionId);
    expect(dropErr).toBeNull();

    const { count: resourceCount } = await service
      .from('knowledge_resources')
      .select('id', { count: 'exact', head: true })
      .eq('space_id', tenant.spaceId);
    const { count: edgeCount } = await service
      .from('knowledge_edges')
      .select('id', { count: 'exact', head: true })
      .eq('space_id', tenant.spaceId);
    // The KB graph (3 lessons + tag node; 2 prerequisite + 2 tagged edges)
    // survives intact: the course is one removable projections row, not structure.
    expect(resourceCount).toBe(4);
    expect(edgeCount).toBe(4);

    // Re-add it: the second app view is recreated by a single INSERT, zero DDL.
    const { error: readdErr } = await service.from('projections').insert({
      id: graph.courseProjectionId,
      space_id: tenant.spaceId,
      app_type: 'course',
      name: 'Intro Course',
      view: 'course',
      spec: COURSE_SPEC,
      created_by: tenant.granted.userId,
      owner_user_id: tenant.granted.userId,
    });
    expect(readdErr).toBeNull();
  });

  test('RLS: ungranted member sees zero domain rows but reads global vocabularies', async () => {
    const db = tenant.ungranted.client;

    // No `space.knowledge.read` → domain rows are invisible under RLS.
    const { data: resources, error: resErr } = await db
      .from('knowledge_resources')
      .select('id')
      .eq('space_id', tenant.spaceId);
    expect(resErr).toBeNull();
    expect(resources).toEqual([]);

    const { data: edges, error: edgeErr } = await db
      .from('knowledge_edges')
      .select('id')
      .eq('space_id', tenant.spaceId);
    expect(edgeErr).toBeNull();
    expect(edges).toEqual([]);

    const { data: projections, error: prjErr } = await db
      .from('projections')
      .select('id')
      .eq('space_id', tenant.spaceId);
    expect(prjErr).toBeNull();
    expect(projections).toEqual([]);

    // Global reference vocabularies remain readable to any authenticated user.
    const { data: kinds, error: kindsErr } = await db
      .from('resource_kinds')
      .select('key');
    expect(kindsErr).toBeNull();
    expect(kinds?.map((k) => k.key)).toEqual(
      expect.arrayContaining(['text', 'link'])
    );

    const { data: views, error: viewsErr } = await db
      .from('view_types')
      .select('key');
    expect(viewsErr).toBeNull();
    expect(views?.map((v) => v.key)).toEqual(
      expect.arrayContaining(['grid', 'list', 'course'])
    );
  });

  test('RLS: granted member CAN read the domain rows it owns', async () => {
    const db = tenant.granted.client;

    const { data: resources, error } = await db
      .from('knowledge_resources')
      .select('id')
      .eq('space_id', tenant.spaceId);
    expect(error).toBeNull();
    expect(resources).toHaveLength(4);
  });

  test('owner_user_id defaults to created_by on insert (finding #4)', async () => {
    // A node inserted WITHOUT owner_user_id must come back with owner_user_id =
    // created_by (the BEFORE INSERT trigger), so the manager-hierarchy access
    // dimension always has a non-null owner to resolve against (never inert).
    const db = tenant.granted.client;
    const { data: created, error: insErr } = await db
      .from('knowledge_resources')
      .insert({
        space_id: tenant.spaceId,
        kind: 'text',
        title: 'Owner default probe',
        created_by: tenant.granted.userId,
        // owner_user_id intentionally OMITTED
      })
      .select('id,created_by,owner_user_id')
      .single();
    expect(insErr).toBeNull();
    expect(created?.owner_user_id).toBe(tenant.granted.userId);
    expect(created?.owner_user_id).toBe(created?.created_by);

    await tenant.service
      .from('knowledge_resources')
      .delete()
      .eq('id', created!.id);
  });

  test('created_by is immutable on update (finding #5)', async () => {
    // created_by gates body-bridge creator authority; an editor must NOT be able
    // to rewrite it and transfer that authority. The BEFORE UPDATE trigger rejects
    // any attempt to change created_by.
    const db = tenant.granted.client;
    const { data: node, error: insErr } = await db
      .from('knowledge_resources')
      .insert({
        space_id: tenant.spaceId,
        kind: 'text',
        title: 'created_by immutability probe',
        created_by: tenant.granted.userId,
        owner_user_id: tenant.granted.userId,
      })
      .select('id')
      .single();
    expect(insErr).toBeNull();

    // Attempt to reassign created_by to the ungranted user → must be rejected.
    const { error: rewriteErr } = await db
      .from('knowledge_resources')
      .update({ created_by: tenant.ungranted.userId })
      .eq('id', node!.id);
    expect(rewriteErr).not.toBeNull();
    expect(rewriteErr?.message).toContain('immutable');

    // created_by is unchanged (verified service-side, bypassing RLS).
    const { data: after } = await tenant.service
      .from('knowledge_resources')
      .select('created_by')
      .eq('id', node!.id)
      .single();
    expect(after?.created_by).toBe(tenant.granted.userId);

    await tenant.service
      .from('knowledge_resources')
      .delete()
      .eq('id', node!.id);
  });
});
