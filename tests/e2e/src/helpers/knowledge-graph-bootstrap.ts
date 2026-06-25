/**
 * Runtime bootstrap shared by BOTH knowledge-graph e2e suites — the Invariant #1
 * acceptance test and the projection-engine test (docs/knowledge-graph-plan.md
 * §4–6). One unified `seedKnowledgeGraph` builds the single Variant-B graph; the
 * KB and course ProjectionSpecs have ONE source of truth (`buildKnowledgeBaseSpec`
 * / `COURSE_SPEC`) so the saved specs can never drift between suites.
 *
 * Builds a fully isolated tenant (org + space + actors) through the SAME runtime
 * path the product uses — service-role inserts into organizations/spaces/
 * memberships plus an RBAC `user_role` grant — never raw inserts of dropped
 * columns. Space/org roles live in `user_role`; `auth_user_can_access_in_space`
 * reads exactly that table for `space.knowledge.*`.
 *
 * The GRANTED actor receives the `admin` space system role (which carries all
 * four `space.knowledge.*` verbs, per the knowledge_graph migration). A second
 * UNGRANTED actor receives only `space_admin` (no knowledge verbs) so the test
 * can prove RLS denies domain rows while global vocabularies stay readable.
 *
 * This replaces the deleted demo-seed migration: the Invariant #1 demo data is
 * created here at runtime and torn down after the test, so production carries
 * zero hardcoded demo rows. See docs/knowledge-graph-plan.md §6.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { request } from '@playwright/test';

import {
  actorCookieHeader,
  actorSsrAuthCookies,
  addActor,
  authenticatedClient,
  bootstrapEphemeralTenant,
  bootstrapMemberActor,
  buildBoardSpec,
  buildKnowledgeBaseSpec,
  createActor,
  makeSeedClient,
  materializeScenario,
  PER_USER_SHARE_SCENARIO,
  resolveRoleIds,
  slug,
  teardownTenant,
  type MaterializedScenario,
  type SeedActor,
  type SeedClient,
  type SeedFetcher,
  type SeedScenario,
  type SeedTenant,
} from '@workspace/seed';

// The runtime tenant/actor/cookie primitives + the projection spec builders now
// live in `@workspace/seed` (one source of truth shared by the demo seed and the
// tests). Re-export them under the e2e-facing names the specs already import; the
// e2e-SPECIFIC scenario seeders below compose them. Migration seeds stay
// forbidden — every row is created at runtime through the product's RLS path.
export {
  actorSsrAuthCookies,
  bootstrapMemberActor,
  buildBoardSpec,
  buildKnowledgeBaseSpec,
};

/**
 * Course ProjectionSpec — an OUTGOING `prerequisite` walk over the graph. Used ONLY
 * by the knowledge-graph e2e suites as the generative-core PROOF (a SECOND app type
 * = pure configuration over the same graph; Invariant #1 / ADR-0004). It is NOT
 * seed/demo content — there is no Course product surface yet — so it lives HERE, in
 * the e2e harness, not in the `@workspace/seed` catalog.
 */
export const COURSE_SPEC = {
  schema_version: 1,
  filter: { field: 'status', op: 'eq', value: 'active' },
  traversal: {
    start: { filter: { field: 'kind', op: 'eq', value: 'text' } },
    relation_types: ['prerequisite'],
    direction: 'outgoing',
    max_depth: 16,
    order_by: 'position',
  },
  view: 'course',
} as const;

/** An authenticated actor (user JWT, subject to RLS). */
export type KnowledgeActor = SeedActor;
/** A provisioned org + space + two base actors (granted/admin + ungranted). */
export type KnowledgeGraphTenant = SeedTenant;

/** Bootstrap an isolated runtime tenant (alias of the shared engine primitive). */
export const bootstrapKnowledgeGraphTenant = bootstrapEphemeralTenant;

/** Tear down an ephemeral tenant + its actors (alias of the shared primitive). */
export const teardownKnowledgeGraphTenant = teardownTenant;

/** Stable ids of the demo graph the test seeds over the one tenant. */
export type DemoGraph = {
  /** Three text lessons, sorted by title (L1, L2, L3). */
  resourceIds: [string, string, string];
  /** prerequisite edge ids L1→L2, L2→L3 (sorted by position). */
  edgeIds: [string, string];
  /** The `kind='tag'` node titled 'KB' — start node of the Variant-B KB spec. */
  tagNodeId: string;
  /** `tagged` edge ids from the lessons tagged into the KB tag. */
  taggedEdgeIds: string[];
  /** The lesson ids that carry a `tagged` edge into the KB tag (L1, L2). */
  taggedLessonIds: string[];
  knowledgeBaseProjectionId: string;
  courseProjectionId: string;
};

/**
 * Variant-B demo graph for the projection-engine e2e. ONE resource/edge set
 * serves BOTH projections: three text lessons chained by `prerequisite` edges
 * (course), plus a `kind='tag'` node with `tagged` edges from the lessons it
 * tags (KB). Both projections resolve over this identical set — "projection,
 * not fork" at the execution level.
 */
export type ProjectionEngineGraph = {
  /** Three text lessons, sorted by title (L1, L2, L3). */
  lessonIds: [string, string, string];
  /** The `kind='tag'` node titled 'KB'. */
  tagNodeId: string;
  /** prerequisite edge ids L1→L2, L2→L3 (sorted by position). */
  prerequisiteEdgeIds: [string, string];
  /** `tagged` edge ids from the lessons tagged into the KB tag. */
  taggedEdgeIds: string[];
  /** The lesson ids that carry a `tagged` edge into the KB tag. */
  taggedLessonIds: string[];
  knowledgeBaseProjectionId: string;
  courseProjectionId: string;
};

/**
 * Seed the Variant-B knowledge graph over the one tenant, AS the granted actor
 * (every write passes RLS `with check`). ONE resource/edge set backs BOTH
 * projections — this is the single graph both e2e suites consume:
 *  - three text lessons L1→L2→L3 chained by `prerequisite` edges (course),
 *  - a `kind='tag'` node 'KB' with `tagged` edges from L1 and L2 (KB).
 * L3 is intentionally NOT tagged, so the KB projection proves it selects via the
 * `tagged` traversal rather than returning every resource.
 *
 * The KB spec starts at the tag node (`start.ids = [tagNodeId]`), walks INCOMING
 * `tagged` edges (canonical direction resource→tag) at depth 1, then filters
 * `kind in (text, link)`. The course spec starts at `kind=text`, walks OUTGOING
 * `prerequisite` at depth 16, filters `status=active`. Both specs come from the
 * shared `buildKnowledgeBaseSpec` / `COURSE_SPEC` source of truth above.
 */
async function seedKnowledgeGraph(
  tenant: KnowledgeGraphTenant
): Promise<ProjectionEngineGraph> {
  const { granted, spaceId } = tenant;
  const db = granted.client;

  const { data: lessons, error: lessonErr } = await db
    .from('knowledge_resources')
    .insert([
      {
        space_id: spaceId,
        kind: 'text',
        title: 'Lesson 1 — Foundations',
        status: 'active',
        created_by: granted.userId,
        owner_user_id: granted.userId,
      },
      {
        space_id: spaceId,
        kind: 'text',
        title: 'Lesson 2 — Building Blocks',
        status: 'active',
        created_by: granted.userId,
        owner_user_id: granted.userId,
      },
      {
        space_id: spaceId,
        kind: 'text',
        title: 'Lesson 3 — Putting It Together',
        status: 'active',
        created_by: granted.userId,
        owner_user_id: granted.userId,
      },
    ])
    .select('id,title');
  if (lessonErr || !lessons || lessons.length !== 3) {
    throw new Error(
      `seedKnowledgeGraph lessons: ${lessonErr?.message ?? 'count'}`
    );
  }
  const lessonIds = [...lessons]
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((r) => r.id) as [string, string, string];

  // Tag node (kind='tag') — a graph node, not a column value (Variant B).
  const { data: tag, error: tagErr } = await db
    .from('knowledge_resources')
    .insert({
      space_id: spaceId,
      kind: 'tag',
      title: 'KB',
      status: 'active',
      created_by: granted.userId,
      owner_user_id: granted.userId,
    })
    .select('id')
    .single();
  if (tagErr || !tag?.id) {
    throw new Error(`seedKnowledgeGraph tag: ${tagErr?.message ?? 'no id'}`);
  }
  const tagNodeId = tag.id;

  // prerequisite chain L1 → L2 → L3 (course).
  const { data: prereq, error: prereqErr } = await db
    .from('knowledge_edges')
    .insert([
      {
        space_id: spaceId,
        from_id: lessonIds[0],
        to_id: lessonIds[1],
        relation_type: 'prerequisite',
        position: 0,
        created_by: granted.userId,
      },
      {
        space_id: spaceId,
        from_id: lessonIds[1],
        to_id: lessonIds[2],
        relation_type: 'prerequisite',
        position: 1,
        created_by: granted.userId,
      },
    ])
    .select('id,position');
  if (prereqErr || !prereq || prereq.length !== 2) {
    throw new Error(
      `seedKnowledgeGraph prerequisite: ${prereqErr?.message ?? 'count'}`
    );
  }
  const prerequisiteEdgeIds = [...prereq]
    .sort((a, b) => a.position - b.position)
    .map((e) => e.id) as [string, string];

  // tagged edges (resource → tag): L1 and L2 are in the KB; L3 is not.
  const taggedLessonIds = [lessonIds[0], lessonIds[1]];
  const { data: tagged, error: taggedErr } = await db
    .from('knowledge_edges')
    .insert(
      taggedLessonIds.map((lessonId, i) => ({
        space_id: spaceId,
        from_id: lessonId,
        to_id: tagNodeId,
        relation_type: 'tagged',
        position: i,
        created_by: granted.userId,
      }))
    )
    .select('id');
  if (taggedErr || !tagged || tagged.length !== taggedLessonIds.length) {
    throw new Error(
      `seedKnowledgeGraph tagged: ${taggedErr?.message ?? 'count'}`
    );
  }
  const taggedEdgeIds = tagged.map((e) => e.id);

  const { data: projections, error: prjErr } = await db
    .from('projections')
    .insert([
      {
        space_id: spaceId,
        app_type: 'knowledge_base',
        name: 'Knowledge Base',
        view: 'grid',
        spec: buildKnowledgeBaseSpec(tagNodeId),
        created_by: granted.userId,
        owner_user_id: granted.userId,
      },
      {
        space_id: spaceId,
        app_type: 'course',
        name: 'Intro Course',
        view: 'course',
        spec: COURSE_SPEC,
        created_by: granted.userId,
        owner_user_id: granted.userId,
      },
    ])
    .select('id,app_type');
  if (prjErr || !projections || projections.length !== 2) {
    throw new Error(
      `seedKnowledgeGraph projections: ${prjErr?.message ?? 'count'}`
    );
  }
  const byApp = new Map(projections.map((p) => [p.app_type, p.id]));
  const knowledgeBaseProjectionId = byApp.get('knowledge_base');
  const courseProjectionId = byApp.get('course');
  if (!knowledgeBaseProjectionId || !courseProjectionId) {
    throw new Error('seedKnowledgeGraph projections: app_type ids missing');
  }

  return {
    lessonIds,
    tagNodeId,
    prerequisiteEdgeIds,
    taggedEdgeIds,
    taggedLessonIds,
    knowledgeBaseProjectionId,
    courseProjectionId,
  };
}

/**
 * Seed the Invariant #1 demo graph over the one tenant. Delegates to the SAME
 * unified `seedKnowledgeGraph` the projection-engine suite uses, then projects
 * its result onto the `DemoGraph` shape the invariant spec consumes. One graph,
 * two projections (knowledge_base + course) — added as data, zero migration.
 */
export async function seedDemoGraph(
  tenant: KnowledgeGraphTenant
): Promise<DemoGraph> {
  const graph = await seedKnowledgeGraph(tenant);
  return {
    resourceIds: graph.lessonIds,
    edgeIds: graph.prerequisiteEdgeIds,
    tagNodeId: graph.tagNodeId,
    taggedEdgeIds: graph.taggedEdgeIds,
    taggedLessonIds: graph.taggedLessonIds,
    knowledgeBaseProjectionId: graph.knowledgeBaseProjectionId,
    courseProjectionId: graph.courseProjectionId,
  };
}

/**
 * Seed the Variant-B projection-engine demo graph over the one tenant. Delegates
 * to the SAME unified `seedKnowledgeGraph` and returns its full shape.
 */
export async function seedProjectionEngineDemo(
  tenant: KnowledgeGraphTenant
): Promise<ProjectionEngineGraph> {
  return seedKnowledgeGraph(tenant);
}

// ── slice-06: resource-workflow + board (requires_state) demo ────────────────
//
// The third vertical lands as PURE CONFIGURATION over the SAME graph: a `board`
// view_types row + document nodes carrying `workflow_key='document_review'` and
// distinct statuses + a board `projections` row declaring the `requires_state`
// gating rule. ZERO new tables, ZERO engine/resolver fork — added entirely as
// data in the harness (the lesson from identity-sync: demo nodes/projections are
// never migration-seeded; only the workflow DEFINITIONS are).

/** Stable ids of the slice-06 workflow/board demo seeded over the one tenant. */
export type WorkflowGatingGraph = {
  /** The `kind='tag'` node titled 'Docs' — start node of the board spec. */
  docsTagNodeId: string;
  /** Document node currently in `draft` status. */
  draftDocId: string;
  /** Document node currently in `in_review` status. */
  inReviewDocId: string;
  /** Document node currently in `approved` status. */
  approvedDocId: string;
  /** Titles, for DOM assertions (sorted by title in the board). */
  draftTitle: string;
  inReviewTitle: string;
  approvedTitle: string;
  boardProjectionId: string;
};

/**
 * Ensure the `board` view_types vocabulary row exists (service-role; global
 * reference data). The slice-06 migration seeds workflow DEFINITIONS but NOT the
 * `board` view row (per §4.1 the view_types row is harness data, not a core
 * migration). `projections.view` is FK-checked against `view_types(key)`, so the
 * row must exist before a board projection can be inserted. Idempotent.
 */
async function ensureBoardViewType(service: SupabaseClient): Promise<void> {
  const { error } = await service.from('view_types').upsert(
    {
      key: 'board',
      label: 'Board',
      description: 'Status-segmented board view.',
    },
    { onConflict: 'key' }
  );
  if (error) {
    throw new Error(`ensureBoardViewType: ${error.message}`);
  }
}

/**
 * Seed the slice-06 document-review demo over the existing tenant, AS the granted
 * actor (every write passes RLS). Three document nodes with distinct statuses
 * (draft / in_review / approved), all carrying `workflow_key='document_review'`,
 * a 'Docs' tag node with `tagged` edges from each doc, and a board projection
 * declaring `requires_state({ allowed: ['approved'] })`. Same resolver, same
 * registry, different values — the third vertical as data.
 */
export async function seedWorkflowGatingDemo(
  tenant: KnowledgeGraphTenant
): Promise<WorkflowGatingGraph> {
  const { granted, spaceId, service } = tenant;
  const db = granted.client;

  await ensureBoardViewType(service);

  const draftTitle = 'Doc A — Draft Proposal';
  const inReviewTitle = 'Doc B — Under Review';
  const approvedTitle = 'Doc C — Approved Policy';

  const { data: docs, error: docsErr } = await db
    .from('knowledge_resources')
    .insert([
      {
        space_id: spaceId,
        kind: 'text',
        title: draftTitle,
        status: 'draft',
        workflow_key: 'document_review',
        created_by: granted.userId,
        owner_user_id: granted.userId,
      },
      {
        space_id: spaceId,
        kind: 'text',
        title: inReviewTitle,
        status: 'in_review',
        workflow_key: 'document_review',
        created_by: granted.userId,
        owner_user_id: granted.userId,
      },
      {
        space_id: spaceId,
        kind: 'text',
        title: approvedTitle,
        status: 'approved',
        workflow_key: 'document_review',
        created_by: granted.userId,
        owner_user_id: granted.userId,
      },
    ])
    .select('id,title,status');
  if (docsErr || !docs || docs.length !== 3) {
    throw new Error(
      `seedWorkflowGatingDemo docs: ${docsErr?.message ?? 'count'}`
    );
  }
  const byStatus = new Map(docs.map((d) => [d.status, d.id]));
  const draftDocId = byStatus.get('draft');
  const inReviewDocId = byStatus.get('in_review');
  const approvedDocId = byStatus.get('approved');
  if (!draftDocId || !inReviewDocId || !approvedDocId) {
    throw new Error('seedWorkflowGatingDemo docs: status ids missing');
  }

  // 'Docs' tag node + `tagged` edges (doc → tag), the Variant-B selection seam.
  const { data: tag, error: tagErr } = await db
    .from('knowledge_resources')
    .insert({
      space_id: spaceId,
      kind: 'tag',
      title: 'Docs',
      status: 'active',
      created_by: granted.userId,
      owner_user_id: granted.userId,
    })
    .select('id')
    .single();
  if (tagErr || !tag?.id) {
    throw new Error(
      `seedWorkflowGatingDemo tag: ${tagErr?.message ?? 'no id'}`
    );
  }
  const docsTagNodeId = tag.id;

  const { error: edgeErr } = await db.from('knowledge_edges').insert(
    [draftDocId, inReviewDocId, approvedDocId].map((docId, i) => ({
      space_id: spaceId,
      from_id: docId,
      to_id: docsTagNodeId,
      relation_type: 'tagged',
      position: i,
      created_by: granted.userId,
    }))
  );
  if (edgeErr) {
    throw new Error(`seedWorkflowGatingDemo tagged: ${edgeErr.message}`);
  }

  const { data: prj, error: prjErr } = await db
    .from('projections')
    .insert({
      space_id: spaceId,
      app_type: 'knowledge_base',
      name: 'Documents',
      view: 'board',
      spec: buildBoardSpec(docsTagNodeId),
      created_by: granted.userId,
      owner_user_id: granted.userId,
    })
    .select('id')
    .single();
  if (prjErr || !prj?.id) {
    throw new Error(
      `seedWorkflowGatingDemo projection: ${prjErr?.message ?? 'no id'}`
    );
  }

  return {
    docsTagNodeId,
    draftDocId,
    inReviewDocId,
    approvedDocId,
    draftTitle,
    inReviewTitle,
    approvedTitle,
    boardProjectionId: prj.id,
  };
}

// ── slice-06: extra actor for the transition guard split ─────────────────────
//
// The guard test needs an actor that CAN move a workflow (space.knowledge.transition
// + .read + .update) but CANNOT approve (lacks space.knowledge.approve). The
// system `author` role fits exactly: the knowledge_graph migration grants it
// read/create/update and the resource_workflow migration grants it `transition`,
// but neither grants it `approve` (that maps onto `admin` only).

export type WorkflowActors = {
  /** Actor with the `author` role: transition + update, but NOT approve. */
  transitioner: KnowledgeActor;
  /** Extra user ids to cascade-clean on teardown. */
  extraUserIds: string[];
};

export async function bootstrapWorkflowActors(
  tenant: KnowledgeGraphTenant
): Promise<WorkflowActors> {
  const { service, organizationId, spaceId } = tenant;

  const user = await createActor(service, 'workflow-author');

  const { error: omErr } = await service
    .from('organization_memberships')
    .insert({ organization_id: organizationId, user_id: user.id });
  if (omErr) throw new Error(`workflow org_membership: ${omErr.message}`);

  const { error: smErr } = await service
    .from('space_memberships')
    .insert({ space_id: spaceId, user_id: user.id, status: 'active' });
  if (smErr) throw new Error(`workflow space_membership: ${smErr.message}`);

  const { data: authorRole, error: roleErr } = await service
    .from('roles')
    .select('id')
    .eq('key', 'author')
    .eq('role_kind', 'system')
    .single();
  if (roleErr || !authorRole?.id) {
    throw new Error(`workflow author role: ${roleErr?.message ?? 'no id'}`);
  }

  const { error: urErr } = await service
    .from('user_role')
    .insert({ user_id: user.id, space_id: spaceId, role_id: authorRole.id });
  if (urErr) throw new Error(`workflow user_role: ${urErr.message}`);

  const client = await authenticatedClient(user.email, user.password);

  return {
    transitioner: {
      userId: user.id,
      email: user.email,
      password: user.password,
      client,
    },
    extraUserIds: [user.id],
  };
}

/**
 * slice-03 acceptance fixture: a single EXISTING target node (the prerequisite
 * edge points at it) + a `kind='tag'` KB tag node + a saved KB projection that
 * selects resources tagged into it. Seeded AS the granted actor (every write
 * passes RLS). The new fan-out resource is later tagged into this KB tag so the
 * projection resolves it (acceptance step 5).
 */
export type BodyBridgeFixture = {
  targetNodeId: string;
  tagNodeId: string;
  knowledgeBaseProjectionId: string;
};

export async function seedBodyBridgeFixture(
  tenant: KnowledgeGraphTenant
): Promise<BodyBridgeFixture> {
  const { granted, spaceId } = tenant;
  const db = granted.client;

  const { data: target, error: targetErr } = await db
    .from('knowledge_resources')
    .insert({
      space_id: spaceId,
      kind: 'text',
      title: 'Existing Target Lesson',
      status: 'active',
      created_by: granted.userId,
      owner_user_id: granted.userId,
    })
    .select('id')
    .single();
  if (targetErr || !target?.id) {
    throw new Error(
      `seedBodyBridgeFixture target: ${targetErr?.message ?? 'no id'}`
    );
  }

  const { data: tag, error: tagErr } = await db
    .from('knowledge_resources')
    .insert({
      space_id: spaceId,
      kind: 'tag',
      title: 'KB',
      status: 'active',
      created_by: granted.userId,
      owner_user_id: granted.userId,
    })
    .select('id')
    .single();
  if (tagErr || !tag?.id) {
    throw new Error(`seedBodyBridgeFixture tag: ${tagErr?.message ?? 'no id'}`);
  }

  const { data: prj, error: prjErr } = await db
    .from('projections')
    .insert({
      space_id: spaceId,
      app_type: 'knowledge_base',
      name: 'Knowledge Base',
      view: 'grid',
      spec: buildKnowledgeBaseSpec(tag.id),
      created_by: granted.userId,
      owner_user_id: granted.userId,
    })
    .select('id')
    .single();
  if (prjErr || !prj?.id) {
    throw new Error(
      `seedBodyBridgeFixture projection: ${prjErr?.message ?? 'no id'}`
    );
  }

  return {
    targetNodeId: target.id,
    tagNodeId: tag.id,
    knowledgeBaseProjectionId: prj.id,
  };
}

// ── slice-05: extra actors for the per-user-gating suite ─────────────────────
//
// The per-user-gating test needs, beyond the base tenant's `granted` (admin) and
// `ungranted` (space_admin) actors:
//  - a SECOND granted actor B in the same space (admin role → has progress) to
//    prove own-rows isolation A↔B;
//  - a READER actor with `space.knowledge.read` but NOT `space.knowledge.progress`
//    (a learner who can see the course but lacks the write verb) to prove the
//    read/progress split. No system role fits, so a tiny org-scoped custom role
//    is minted at runtime carrying only `space.knowledge.read`.

export type PerUserGatingActors = {
  /** A second admin actor in the same space (own-rows isolation A↔B). */
  actorB: KnowledgeActor;
  /** Read-only actor: space.knowledge.read but NOT space.knowledge.progress. */
  reader: KnowledgeActor;
  /** Extra user ids to cascade-clean on teardown. */
  extraUserIds: string[];
};

/**
 * Add the slice-05 gating actors to an existing tenant: a second admin actor B
 * and a read-only actor. Both are space members in the SAME space, created
 * through the real RBAC path (service-role memberships + `user_role`), never raw
 * inserts of dropped columns.
 */
export async function bootstrapPerUserGatingActors(
  tenant: KnowledgeGraphTenant
): Promise<PerUserGatingActors> {
  const { service, organizationId, spaceId } = tenant;

  // ── actor B: a second admin in the same space ──────────────────────────────
  const userB = await createActor(service, 'gating-b');
  // ── reader: read-only learner (no progress verb) ───────────────────────────
  const readerUser = await createActor(service, 'gating-reader');

  const { error: omErr } = await service
    .from('organization_memberships')
    .insert([
      { organization_id: organizationId, user_id: userB.id },
      { organization_id: organizationId, user_id: readerUser.id },
    ]);
  if (omErr) throw new Error(`gating org_membership: ${omErr.message}`);

  const { error: smErr } = await service.from('space_memberships').insert([
    { space_id: spaceId, user_id: userB.id, status: 'active' },
    { space_id: spaceId, user_id: readerUser.id, status: 'active' },
  ]);
  if (smErr) throw new Error(`gating space_membership: ${smErr.message}`);

  const { adminRoleId } = await resolveRoleIds(service);

  // A custom org-scoped role carrying ONLY space.knowledge.read — proves the
  // read/progress split: this actor reads the course but cannot write progress.
  const { data: readRole, error: roleErr } = await service
    .from('roles')
    .insert({
      key: `kg-reader-${slug()}`,
      label: 'KG Reader (read-only)',
      scope: 'space',
      role_kind: 'custom',
      owner_organization_id: organizationId,
    })
    .select('id')
    .single();
  if (roleErr || !readRole?.id) {
    throw new Error(`gating reader role: ${roleErr?.message ?? 'no id'}`);
  }
  const { data: readPerm, error: permErr } = await service
    .from('permissions')
    .select('id')
    .eq('key', 'space.knowledge.read')
    .single();
  if (permErr || !readPerm?.id) {
    throw new Error(`gating read permission: ${permErr?.message ?? 'no id'}`);
  }
  const { error: rpErr } = await service
    .from('role_permission')
    .insert({ role_id: readRole.id, permission_id: readPerm.id });
  if (rpErr) throw new Error(`gating role_permission: ${rpErr.message}`);

  const { error: urErr } = await service.from('user_role').insert([
    { user_id: userB.id, space_id: spaceId, role_id: adminRoleId },
    { user_id: readerUser.id, space_id: spaceId, role_id: readRole.id },
  ]);
  if (urErr) throw new Error(`gating user_role: ${urErr.message}`);

  const clientB = await authenticatedClient(userB.email, userB.password);
  const readerClient = await authenticatedClient(
    readerUser.email,
    readerUser.password
  );

  return {
    actorB: {
      userId: userB.id,
      email: userB.email,
      password: userB.password,
      client: clientB,
    },
    reader: {
      userId: readerUser.id,
      email: readerUser.email,
      password: readerUser.password,
      client: readerClient,
    },
    extraUserIds: [userB.id, readerUser.id],
  };
}

// ── slice-07: access-layer (cohort + hierarchy) demo ─────────────────────────
//
// Hard-access dimensions are RLS, never gating: a failing dimension HIDES the
// node (absent from `items`). The demo lives entirely in the harness (the
// identity-sync lesson): a cohort scope + memberships + knowledge_resource_scopes
// on SOME nodes, a reporting_lines chain (mgr2 → mgr → subordinate), and nodes
// owned by the subordinate. Vocab/tables are migrated; cohorts/lines/links are
// data (INSERT rows, zero DDL per cohort).

export type AccessLayerActors = {
  /** Member of cohort scope-A (sees scope-restricted nodes via the cohort branch). */
  cohortMember: KnowledgeActor;
  /** NOT a member of scope-A (scope-restricted nodes are hidden). */
  cohortStranger: KnowledgeActor;
  /** Manager of `subordinate` (sees subordinate-owned nodes via hierarchy). */
  manager: KnowledgeActor;
  /** Owner of the hierarchy-owned demo nodes; reports to `manager`. */
  subordinate: KnowledgeActor;
  /** Peer of `subordinate` (no line) — does NOT see subordinate-owned nodes. */
  peer: KnowledgeActor;
  /** Manager of `manager` (transitivity: sees subordinate-owned nodes via recursion). */
  managerOfManager: KnowledgeActor;
  /** Extra user ids to cascade-clean on teardown. */
  extraUserIds: string[];
};

export type AccessLayerGraph = {
  /** scope-A id (the cohort restricting `cohortRestrictedNodeId`). */
  scopeAId: string;
  /** floor=private + scope-A grant: visible to cohort members + owner only (ADR-0017 Model B). */
  cohortRestrictedNodeId: string;
  cohortRestrictedTitle: string;
  /** A published node (floor='space', no grant needed): visible to all space members. */
  unrestrictedNodeId: string;
  unrestrictedTitle: string;
  /** floor=private, owned by `subordinate`, empty cohort: surfaces ONLY via the manager hierarchy. */
  hierarchyNodeId: string;
  hierarchyTitle: string;
  /** A node BOTH scope-A-restricted AND owned by `subordinate` (composition test). */
  composedNodeId: string;
  composedTitle: string;
  /** 'Access KB' tag node + saved KB projection selecting the demo nodes via `tagged`. */
  tagNodeId: string;
  projectionId: string;
};

/**
 * Add the slice-07 access-layer actors to an existing tenant: cohort member /
 * stranger, a manager → subordinate → (mgr-of-mgr) chain, and a peer. All are
 * active space members carrying the `admin` role (so base read access holds —
 * the access DIMENSION, not the verb, is what the test exercises). Created
 * through the real RBAC path (service-role memberships + `user_role`).
 */
export async function bootstrapAccessLayerActors(
  tenant: KnowledgeGraphTenant
): Promise<AccessLayerActors> {
  const { service, organizationId, spaceId } = tenant;
  const { adminRoleId } = await resolveRoleIds(service);

  const labels = [
    'cohort-member',
    'cohort-stranger',
    'manager',
    'subordinate',
    'peer',
    'manager-of-manager',
  ] as const;

  const created = await Promise.all(
    labels.map((label) => createActor(service, label))
  );

  const { error: omErr } = await service
    .from('organization_memberships')
    .insert(
      created.map((u) => ({ organization_id: organizationId, user_id: u.id }))
    );
  if (omErr) throw new Error(`access org_membership: ${omErr.message}`);

  const { error: smErr } = await service.from('space_memberships').insert(
    created.map((u) => ({
      space_id: spaceId,
      user_id: u.id,
      status: 'active',
    }))
  );
  if (smErr) throw new Error(`access space_membership: ${smErr.message}`);

  const { error: urErr } = await service.from('user_role').insert(
    created.map((u) => ({
      user_id: u.id,
      space_id: spaceId,
      role_id: adminRoleId,
    }))
  );
  if (urErr) throw new Error(`access user_role: ${urErr.message}`);

  const actors: KnowledgeActor[] = await Promise.all(
    created.map(async (u) => ({
      userId: u.id,
      email: u.email,
      password: u.password,
      client: await authenticatedClient(u.email, u.password),
    }))
  );

  const [
    cohortMember,
    cohortStranger,
    manager,
    subordinate,
    peer,
    managerOfManager,
  ] = actors;
  if (
    !cohortMember ||
    !cohortStranger ||
    !manager ||
    !subordinate ||
    !peer ||
    !managerOfManager
  ) {
    throw new Error('bootstrapAccessLayerActors: actor set incomplete');
  }

  return {
    cohortMember,
    cohortStranger,
    manager,
    subordinate,
    peer,
    managerOfManager,
    extraUserIds: created.map((u) => u.id),
  };
}

/**
 * Seed the slice-07 access-layer demo over the tenant, as the granted admin actor
 * (every write passes RLS `with check`):
 *  - a cohort scope-A with `cohortMember` enrolled (NOT `cohortStranger`);
 *  - a cohort scope-B with NOBODY enrolled (an empty grant: a private node linked to
 *    scope-B is admitted by no cohort, so only the hierarchy branch can reveal it);
 *  - a `reporting_lines` chain managerOfManager → manager → subordinate;
 *  - four demo nodes tagged into an 'Access KB' tag (ADR-0017 Model B — floor +
 *    additive grants):
 *      • cohortRestricted — floor=private + scope-A grant (members + owner see it);
 *      • unrestricted — floor='space' (published), visible to all space members;
 *      • hierarchy — floor=private, owned by `subordinate`, empty scope-B, so it
 *        surfaces ONLY through the manager-hierarchy branch;
 *      • composed — floor=private + scope-A grant AND owned by `subordinate`
 *        (cohort member sees via grant, manager via hierarchy, stranger neither);
 *  - a saved KB projection selecting these via the incoming `tagged` traversal.
 */
export async function seedAccessLayerDemo(
  tenant: KnowledgeGraphTenant,
  actors: AccessLayerActors
): Promise<AccessLayerGraph> {
  const { granted, spaceId, service } = tenant;
  const db = granted.client;

  // ── cohort scope-A + membership (cohortMember only) ────────────────────────
  const { data: scope, error: scopeErr } = await db
    .from('scopes')
    .insert({
      space_id: spaceId,
      key: `cohort-a-${slug()}`,
      name: 'Cohort A',
      created_by: granted.userId,
    })
    .select('id')
    .single();
  if (scopeErr || !scope?.id) {
    throw new Error(
      `seedAccessLayerDemo scope: ${scopeErr?.message ?? 'no id'}`
    );
  }
  const scopeAId = scope.id;

  const { error: memErr } = await db.from('scope_memberships').insert({
    scope_id: scopeAId,
    user_id: actors.cohortMember.userId,
    created_by: granted.userId,
  });
  if (memErr)
    throw new Error(`seedAccessLayerDemo membership: ${memErr.message}`);

  // ── cohort scope-B with NO members (isolates the hierarchy branch) ─────────
  const { data: scopeB, error: scopeBErr } = await db
    .from('scopes')
    .insert({
      space_id: spaceId,
      key: `cohort-b-${slug()}`,
      name: 'Cohort B',
      created_by: granted.userId,
    })
    .select('id')
    .single();
  if (scopeBErr || !scopeB?.id) {
    throw new Error(
      `seedAccessLayerDemo scope-B: ${scopeBErr?.message ?? 'no id'}`
    );
  }
  const scopeBId = scopeB.id;

  // ── reporting lines: managerOfManager → manager → subordinate ──────────────
  const { error: rlErr } = await db.from('reporting_lines').insert([
    {
      space_id: spaceId,
      manager_id: actors.manager.userId,
      subordinate_id: actors.subordinate.userId,
      created_by: granted.userId,
    },
    {
      space_id: spaceId,
      manager_id: actors.managerOfManager.userId,
      subordinate_id: actors.manager.userId,
      created_by: granted.userId,
    },
  ]);
  if (rlErr)
    throw new Error(`seedAccessLayerDemo reporting_lines: ${rlErr.message}`);

  // ── demo nodes (tag + four content nodes) ──────────────────────────────────
  const cohortRestrictedTitle = 'Access Node — Cohort Restricted';
  const unrestrictedTitle = 'Access Node — Unrestricted';
  const hierarchyTitle = 'Access Node — Hierarchy Owned';
  const composedTitle = 'Access Node — Composed';

  const { data: tag, error: tagErr } = await db
    .from('knowledge_resources')
    .insert({
      space_id: spaceId,
      kind: 'tag',
      title: 'Access KB',
      status: 'active',
      created_by: granted.userId,
      owner_user_id: granted.userId,
      // Published floor: the tag is a SHARED organizing anchor both owners tag into
      // (subordinate tags its own nodes into it). Under private-by-default (Step 3)
      // it would otherwise be private to `granted`, and the cross-owner tagged edge's
      // same-space trigger could not see it as the to-endpoint.
      visibility: 'space',
    })
    .select('id')
    .single();
  if (tagErr || !tag?.id) {
    throw new Error(`seedAccessLayerDemo tag: ${tagErr?.message ?? 'no id'}`);
  }
  const tagNodeId = tag.id;

  // Each node is created BY ITS OWNER, through that owner's RLS — production has no
  // system/service account, so the fixture must not either. Under ADR-0017 Model B a
  // private node is RETURNING-readable only by its owner (is_owner), so a non-owner
  // could not create-and-read it back. (Bulk insert also forces every row to set
  // `visibility` explicitly: PostgREST NULLs a key missing on only SOME rows, so the
  // DB default would not apply.)
  //
  // granted-owned: cohortRestricted (floor=private, later shared to scope-A) +
  // unrestricted (floor='space', published to all members).
  const { data: ownNodes, error: ownErr } = await db
    .from('knowledge_resources')
    .insert([
      {
        space_id: spaceId,
        kind: 'text',
        title: cohortRestrictedTitle,
        status: 'active',
        created_by: granted.userId,
        owner_user_id: granted.userId,
        visibility: 'private',
      },
      {
        space_id: spaceId,
        kind: 'text',
        title: unrestrictedTitle,
        status: 'active',
        created_by: granted.userId,
        owner_user_id: granted.userId,
        visibility: 'space',
      },
    ])
    .select('id,title');
  if (ownErr || !ownNodes) {
    throw new Error(
      `seedAccessLayerDemo own nodes: ${ownErr?.message ?? 'none'}`
    );
  }

  // subordinate-owned: hierarchy + composed (both floor=private), created AS the
  // subordinate so the is_owner branch admits the RETURNING read.
  const subDb = actors.subordinate.client;
  const { data: subNodes, error: subErr } = await subDb
    .from('knowledge_resources')
    .insert([
      {
        space_id: spaceId,
        kind: 'text',
        title: hierarchyTitle,
        status: 'active',
        created_by: actors.subordinate.userId,
        owner_user_id: actors.subordinate.userId,
        visibility: 'private',
      },
      {
        space_id: spaceId,
        kind: 'text',
        title: composedTitle,
        status: 'active',
        created_by: actors.subordinate.userId,
        owner_user_id: actors.subordinate.userId,
        visibility: 'private',
      },
    ])
    .select('id,title');
  if (subErr || !subNodes) {
    throw new Error(
      `seedAccessLayerDemo subordinate nodes: ${subErr?.message ?? 'none'}`
    );
  }

  const nodes = [...ownNodes, ...subNodes];
  if (nodes.length !== 4) {
    throw new Error(`seedAccessLayerDemo nodes: count ${nodes.length}`);
  }
  const byTitle = new Map(nodes.map((n) => [n.title, n.id]));
  const cohortRestrictedNodeId = byTitle.get(cohortRestrictedTitle);
  const unrestrictedNodeId = byTitle.get(unrestrictedTitle);
  const hierarchyNodeId = byTitle.get(hierarchyTitle);
  const composedNodeId = byTitle.get(composedTitle);
  if (
    !cohortRestrictedNodeId ||
    !unrestrictedNodeId ||
    !hierarchyNodeId ||
    !composedNodeId
  ) {
    throw new Error('seedAccessLayerDemo nodes: title ids missing');
  }

  // ── tagged edges (node → tag), the Variant-B selection seam ────────────────
  // Each owner tags ITS OWN nodes (the same-space edge trigger reads the from-
  // endpoint under RLS; a subordinate-owned private node is invisible to `granted`
  // under Model B). The `tag` node is floor='space', so both owners see it as the
  // to-endpoint.
  const taggedEdge = (nodeId: string, position: number, createdBy: string) => ({
    space_id: spaceId,
    from_id: nodeId,
    to_id: tagNodeId,
    relation_type: 'tagged',
    position,
    created_by: createdBy,
  });
  const { error: ownEdgeErr } = await db
    .from('knowledge_edges')
    .insert([
      taggedEdge(cohortRestrictedNodeId, 0, granted.userId),
      taggedEdge(unrestrictedNodeId, 1, granted.userId),
    ]);
  if (ownEdgeErr)
    throw new Error(
      `seedAccessLayerDemo tagged (granted): ${ownEdgeErr.message}`
    );
  const { error: subEdgeErr } = await subDb
    .from('knowledge_edges')
    .insert([
      taggedEdge(hierarchyNodeId, 2, actors.subordinate.userId),
      taggedEdge(composedNodeId, 3, actors.subordinate.userId),
    ]);
  if (subEdgeErr)
    throw new Error(
      `seedAccessLayerDemo tagged (subordinate): ${subEdgeErr.message}`
    );

  // ── cohort links (D9 owner-sovereign: each owner shares ITS OWN node) ──────
  //  - cohortRestricted + composed → scope-A (cohortMember is a member);
  //  - hierarchy → scope-B (NO members): an empty grant, so (with floor=private) it
  //    surfaces ONLY through the manager-hierarchy OR-branch.
  // The link WITH CHECK reads the target node under RLS, so each owner links its own
  // (both actors hold the `access` verb via the admin role). granted links its node,
  // subordinate links the two it owns.
  const { error: ownKrsErr } = await db
    .from('knowledge_resource_scopes')
    .insert({
      resource_id: cohortRestrictedNodeId,
      scope_id: scopeAId,
      linked_by: granted.userId,
    });
  if (ownKrsErr)
    throw new Error(
      `seedAccessLayerDemo scopes (granted): ${ownKrsErr.message}`
    );
  const { error: subKrsErr } = await subDb
    .from('knowledge_resource_scopes')
    .insert([
      {
        resource_id: composedNodeId,
        scope_id: scopeAId,
        linked_by: actors.subordinate.userId,
      },
      {
        resource_id: hierarchyNodeId,
        scope_id: scopeBId,
        linked_by: actors.subordinate.userId,
      },
    ]);
  if (subKrsErr)
    throw new Error(
      `seedAccessLayerDemo scopes (subordinate): ${subKrsErr.message}`
    );

  // ── saved KB projection over the demo nodes (incoming `tagged`) ────────────
  const { data: prj, error: prjErr } = await db
    .from('projections')
    .insert({
      space_id: spaceId,
      app_type: 'knowledge_base',
      name: 'Access KB',
      view: 'grid',
      spec: buildKnowledgeBaseSpec(tagNodeId),
      created_by: granted.userId,
      owner_user_id: granted.userId,
    })
    .select('id')
    .single();
  if (prjErr || !prj?.id) {
    throw new Error(
      `seedAccessLayerDemo projection: ${prjErr?.message ?? 'no id'}`
    );
  }

  // `service` is intentionally unused for assertions here; keep the signature
  // aligned with the other seeders (tenant carries it for the spec).
  void service;

  return {
    scopeAId,
    cohortRestrictedNodeId,
    cohortRestrictedTitle,
    unrestrictedNodeId,
    unrestrictedTitle,
    hierarchyNodeId,
    hierarchyTitle,
    composedNodeId,
    composedTitle,
    tagNodeId,
    projectionId: prj.id,
  };
}

// ── Shared Drive client + dictionary materializer (slice: seed dictionary) ───
//
// The `/author/graph/*` create-vocabulary now lives in `@workspace/seed`. Specs
// drive it through a Playwright-backed `SeedFetcher` (TLS-ignoring, cookie-auth),
// and build their trees from the SAME catalog scenarios the demo seed uses, so the
// database seed and the tests speak one vocabulary.

const SEED_BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'https://proflow.local';

/** Adapt Playwright's `APIRequestContext` to the seed's `SeedFetcher`. */
async function playwrightFetcher(actor: KnowledgeActor): Promise<SeedFetcher> {
  const cookie = await actorCookieHeader(actor);
  const ctx = await request.newContext({
    baseURL: SEED_BASE,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { cookie },
  });
  const toResp = async (r: {
    status(): number;
    json(): Promise<unknown>;
  }): Promise<{ status: number; body: unknown }> => ({
    status: r.status(),
    body: await r.json().catch(() => null),
  });
  return {
    post: async (p, b) => toResp(await ctx.post(p, { data: b })),
    get: async (p) => toResp(await ctx.get(p)),
    patch: async (p, b) => toResp(await ctx.patch(p, { data: b })),
    del: async (p, b) =>
      toResp(await ctx.delete(p, b === undefined ? undefined : { data: b })),
    dispose: () => ctx.dispose(),
  };
}

/** A shared `/author/graph/*` client driven as `actor` (the create-vocabulary). */
export async function seedClientFor(
  actor: KnowledgeActor
): Promise<SeedClient> {
  return makeSeedClient(await playwrightFetcher(actor));
}

/**
 * Materialize a catalog scenario over an existing e2e tenant — the bridge that lets
 * a spec build its tree from the shared dictionary and assert against named `ref`s.
 * Ephemeral actors (no `stable` reuse); scopes/cohorts are minted on demand.
 */
export async function materializeFixture(
  scenario: SeedScenario,
  tenant: KnowledgeGraphTenant
): Promise<MaterializedScenario> {
  return materializeScenario(scenario, {
    tenant,
    clientFor: (a) => seedClientFor(a),
    mintActor: (ref, roleKey) =>
      addActor(tenant, {
        label: `${scenario.id}-${ref}`,
        roleKey,
        stable: false,
      }),
  });
}

// ── ADR-0019: per-person (per-user) sharing fixture ──────────────────────────
//
// The access-matrix spec (grantee sees / third blind / revoke narrows / re-grant
// restores / authority / cross-space) draws ENTIRELY from the shared
// `PER_USER_SHARE_SCENARIO` catalog entry — no inline create helpers — so the demo
// DB and the test build the grant through the one Share transport
// (`POST /author/graph/visibility`, grantType:'user'). `materializeFixture` already
// CREATES the per-user grant (the scenario's `userGrants` field is driven via
// `seedClientFor(owner).grantUser`); this thin wrapper resolves the named refs +
// actors the matrix asserts against (the grantee logs in to confirm visibility; the
// un-granted outsider to confirm fail-closed; the plain-member `bystander` to confirm
// a non-owner non-access-manager cannot grant). The revoke→re-grant arc is driven
// through the SAME shared vocabulary (`seedClientFor(owner).revokeUser` /
// `.grantUser`), so the spec never inlines a raw `del('/author/graph/visibility')`.

/** The display names the per-user-share scenario gives its co-members (ADR-0020):
 * the directory must resolve THESE, never a bare short-id. Kept in sync with the
 * `displayName` fields on `PER_USER_SHARE_SCENARIO.actors`. */
export const PER_USER_SHARE_DISPLAY_NAMES = {
  grantee: 'Grace Granger',
  outsider: 'Otis Outerly',
  bystander: 'Bobby Bystand',
} as const;

/** The per-person-sharing fixture, resolved from the shared catalog scenario. */
export type PerUserShareFixture = {
  /** The space the multi-member directory is scoped to (ADR-0020 GET param). */
  spaceId: string;
  /** The private folder that contains the shared + control docs. */
  folderId: string;
  /** The private doc shared with `grantee` via a per-user grant (visible to grantee). */
  grantedDocId: string;
  /** A private sibling with NO grant (control — neither teammate can see it). */
  unsharedDocId: string;
  /** The resource OWNER (`admin`) — always sees its own private content. */
  owner: KnowledgeActor;
  /** The member the granted doc is shared WITH (sees it via the per-user grant). */
  grantee: KnowledgeActor;
  /** A member with NO grant (the granted doc stays invisible — fail-closed). */
  outsider: KnowledgeActor;
  /** A plain `member` (no `space.knowledge.access`) — proves a non-owner
   * non-access-manager cannot grant/revoke (the authority-negative actor). */
  bystander: KnowledgeActor;
  /** Display names the co-member directory must resolve for the picker / grant rows. */
  displayNames: typeof PER_USER_SHARE_DISPLAY_NAMES;
};

/**
 * Materialize the per-person-sharing scenario over an existing tenant and project
 * its refs/actors onto the matrix-spec shape. The grant is already CREATED by
 * `materializeFixture` through the live Share endpoint; this only names the pieces.
 */
export async function seedPerUserShareFixture(
  tenant: KnowledgeGraphTenant
): Promise<PerUserShareFixture> {
  const { refs, actors } = await materializeFixture(
    PER_USER_SHARE_SCENARIO,
    tenant
  );
  const id = (ref: string): string => {
    const value = refs.get(ref);
    if (!value) throw new Error(`per-user-share fixture: missing ref "${ref}"`);
    return value;
  };
  const who = (ref: string): KnowledgeActor => {
    const actor = actors.get(ref);
    if (!actor)
      throw new Error(`per-user-share fixture: missing actor "${ref}"`);
    return actor;
  };
  return {
    spaceId: tenant.spaceId,
    folderId: id('per-user-share/folder'),
    grantedDocId: id('per-user-share/granted'),
    unsharedDocId: id('per-user-share/unshared'),
    owner: who('admin'),
    grantee: who('grantee'),
    outsider: who('outsider'),
    bystander: who('bystander'),
    displayNames: PER_USER_SHARE_DISPLAY_NAMES,
  };
}
