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
import { PLATFORM_ENTITLEMENT_SETTING_KEYS } from '@workspace/settings-runtime';
import { KB_MEDIA_BUCKET } from '@workspace/knowledge-contracts';

import {
  actorCookieHeader,
  actorSsrAuthCookies,
  addActor,
  ADVANCED_SHARED_SCENARIO,
  authenticatedClient,
  bootstrapEphemeralTenant,
  bootstrapMemberActor,
  buildBoardSpec,
  buildKnowledgeBaseSpec,
  CONTAINMENT_INHERITANCE_SCENARIO,
  createActor,
  DIRECTORY_PICKER_SCENARIO,
  DIRECTORY_PICKER_DISPLAY_NAMES,
  KNOWLEDGE_BASE_SCENARIO,
  makeSeedClient,
  materializeScenario,
  PER_USER_SHARE_SCENARIO,
  resolveRoleIds,
  SHARE_MECHANISM_SCENARIO,
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

// ── ADR-0022 Addendum A: tariff-gated advanced STRUCTURAL-view entitlement (config seed) ──
//
// The advanced (structural) display of the STRUCTURAL lenses (the two Shared lenses +
// Starred + Trash) is gated by the COMMERCIAL `advanced_structural_view` entitlement — a
// scoped `runtime_settings` row resolved global→org→space with org∧space AND-composition
// (a space's plan can never exceed its org's). Wave 1's `rpc_resolve_platform_flag` reads
// it; here we SET it for the test by writing the scoped rows directly via the service-role
// client (a control-plane config write, NOT a knowledge-resource seed — the forbidden path
// is migration-seeding DOMAIN content, not setup-time config). The entitlement is a DISPLAY
// gate, never an access fence: the SAME RLS-visible node-set renders in both modes, so
// toggling it changes pixels, not rows.

const ADVANCED_STRUCTURAL_VIEW_SETTING_KEY =
  PLATFORM_ENTITLEMENT_SETTING_KEYS.advanced_structural_view;

/** Upsert ONE scoped `runtime_settings` boolean row (org or space scope) for the
 * advanced-structural-view entitlement, via service-role (setup only). */
async function upsertEntitlementRow(
  service: SupabaseClient,
  scope: 'organization' | 'space',
  scopeId: string,
  enabled: boolean
): Promise<void> {
  const { error } = await service.from('runtime_settings').upsert(
    {
      scope,
      scope_id: scopeId,
      key: ADVANCED_STRUCTURAL_VIEW_SETTING_KEY,
      value: enabled,
      value_type: 'boolean',
      is_public: false,
    },
    { onConflict: 'scope,key,scope_target' }
  );
  if (error) {
    throw new Error(`upsertEntitlementRow(${scope}): ${error.message}`);
  }
}

/**
 * Set the advanced-structural-view entitlement for a tenant's space (ADR-0022 Addendum A).
 * The resolver AND-composes org∧space, so an ENTITLED space needs BOTH rows true; a
 * "locked" space = either row false/absent. Common cases:
 *   - entitle a space:  setAdvancedStructuralEntitlement(t, { org: true,  space: true })
 *   - lock a space:     (don't call it — absent rows resolve false) OR { org/space:false }
 *   - org-off override: setAdvancedStructuralEntitlement(t, { org: false, space: true })
 */
export async function setAdvancedStructuralEntitlement(
  tenant: KnowledgeGraphTenant,
  opts: { org: boolean; space: boolean }
): Promise<void> {
  await upsertEntitlementRow(
    tenant.service,
    'organization',
    tenant.organizationId,
    opts.org
  );
  await upsertEntitlementRow(
    tenant.service,
    'space',
    tenant.spaceId,
    opts.space
  );
}

// ── ADR-0022: the advanced-shared CONTENT fixture (the shared node-set) ──────
//
// The advanced (structural) view renders the SAME RLS-visible shared node-set as the
// flat digest. That node-set is now a CATALOG scenario (`ADVANCED_SHARED_SCENARIO`) so
// the demo DB and this e2e build the worked-example tree the SAME way, through the one
// `/author/graph/*` create-vocabulary — never an inline `createFolder`/`createDoc` tree.
// `materializeFixture` CREATES it (folders/docs via the live routes, the floor publish via
// `setFloor`, the containment via `contain`); this thin wrapper resolves the named refs +
// the titles the DOM assertions key on. The COMMERCIAL entitlement is control-plane config,
// out of scope for a content scenario — set it separately via `setAdvancedStructuralEntitlement`.

/** The shared-fixture titles the advanced-shared spec's DOM assertions key on — the SAME
 * set must appear in both display modes. Kept in sync with `ADVANCED_SHARED_SCENARIO`. */
export const ADVANCED_SHARED_TITLES = {
  /** The shared folder (published) — gains an expand control in the advanced tree. */
  folder: 'Shared Folder',
  /** Lives inside the shared folder → nests under it in the advanced tree. */
  nested: 'Nested Shared Doc',
  /** Parent folder is NOT shared → roots in the advanced tree (orphan-at-root). */
  orphan: 'Orphan Shared Doc',
} as const;

/** The advanced-shared structural-view fixture, resolved from the shared catalog scenario:
 * a shared folder ⊃ a shared doc (nests) + an orphan doc whose private parent is invisible
 * (roots). `materializeFixture` has already CREATED + published the tree through the runtime
 * RLS path; this only names the pieces the spec asserts against. */
export type AdvancedSharedFixture = {
  /** The space the shared lens is scoped to. */
  spaceId: string;
  /** The published shared folder (the shared container) — `knr_…`. */
  folderId: string;
  /** The published doc inside the shared folder → nests under it in the tree — `knr_…`. */
  nestedDocId: string;
  /** The published doc whose parent folder is private → roots in the tree — `knr_…`. */
  orphanDocId: string;
  /** The titles the DOM assertions key on (folder / nested / orphan). */
  titles: typeof ADVANCED_SHARED_TITLES;
};

/**
 * Materialize the advanced-shared structural-view scenario over an existing tenant and
 * project its refs onto the spec shape. Owned by the tenant's `granted` (`admin`) actor; a
 * non-owning member (see `bootstrapMemberActor`) sees the three published nodes as its
 * whole "Shared with me" set, which both display modes render (flat digest ↔ advanced tree).
 */
export async function seedAdvancedSharedFixture(
  tenant: KnowledgeGraphTenant
): Promise<AdvancedSharedFixture> {
  const { refs } = await materializeFixture(ADVANCED_SHARED_SCENARIO, tenant);
  const id = (ref: string): string => {
    const value = refs.get(ref);
    if (!value)
      throw new Error(`advanced-shared fixture: missing ref "${ref}"`);
    return value;
  };
  return {
    spaceId: tenant.spaceId,
    folderId: id('advanced-shared/folder'),
    nestedDocId: id('advanced-shared/nested'),
    orphanDocId: id('advanced-shared/orphan'),
    titles: ADVANCED_SHARED_TITLES,
  };
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

// ── ADR-0021 Part C: "Shared with me" mechanism-distinction fixture ──────────
//
// Wave 3a landed the DATA layer: the graph annotates each node in the `'shared'` lens
// (visible-not-owned) with the WINNING mechanism that admits the current user, precedence
// `personal > cohort > broadcast` (`annotateShareMechanism` → `KbViewData.shareMechanism`).
// The Wave 3b RENDER agent's badge/facet e2e draws its tree ENTIRELY from the shared
// `SHARE_MECHANISM_SCENARIO` catalog entry (via this fixture) — never an inline
// `createFolder`/`createDoc` or grant/cohort setup — so the demo DB and the test build the
// four admitting mechanisms the SAME way: the per-user grants from the owner via the live
// Share transport (`POST /author/graph/visibility`, grantType:'user'), the cohort link +
// the viewer's membership from the access-manager, the floor publish from the owner —
// every row created at runtime under each actor's own RLS, never a migration seed.
//
// The render spec authenticates AS `viewer` (the single non-owner grantee), loads the
// `'shared'` lens, and asserts each node badges its expected mechanism — `personal/personal`,
// `cohort/cohort`, `broadcast/broadcast` — and that the both-granted node badges `personal`
// (precedence over `cohort`). `materializeFixture` has already CREATED every grant; this
// thin wrapper only resolves the named refs + the three actors the assertions name.

/** The "Shared with me" mechanism-distinction fixture, resolved from the shared catalog
 * scenario. Each `…NodeId` is owned by `owner` (≠ `viewer`), so all four are in the
 * viewer's `'shared'` lens; the field name states the mechanism the viewer must see. */
export type ShareMechanismFixture = {
  /** The space the shared lens + the annotation are scoped to. */
  spaceId: string;
  /** The published folder that contains the four mechanism docs (the shared container). */
  folderId: string;
  /** Per-user granted to `viewer` (sole disjunct) → annotates `personal`. */
  personalNodeId: string;
  /** Fenced to the `mech-cohort` cohort `viewer` belongs to (sole disjunct) → `cohort`. */
  cohortNodeId: string;
  /** Published to the space floor (`visibility='space'`) → `broadcast` (the residual). */
  broadcastNodeId: string;
  /** BOTH per-user-granted AND cohort-fenced to `viewer` → must annotate `personal`
   * (precedence personal > cohort > broadcast). The precedence assertion. */
  bothNodeId: string;
  /** ref → expected `ShareMechanism` ('personal'|'cohort'|'broadcast') for the lens. */
  expected: {
    personal: 'personal';
    cohort: 'cohort';
    broadcast: 'broadcast';
    both: 'personal';
  };
  /** The single non-owner grantee (`member`): sees all four in `'shared'`; the render
   * spec authenticates AS this actor and asserts each node's badge. */
  viewer: KnowledgeActor;
  /** Owns all four nodes (`admin`); authors each node's own grant (owner-sovereign). */
  owner: KnowledgeActor;
  /** The access-manager (the built-in `admin`) that creates the cohort + enrols `viewer`. */
  accessManager: KnowledgeActor;
};

/**
 * Materialize the mechanism-distinction scenario over an existing tenant and project its
 * refs/actors onto the badge-spec shape. The four admitting mechanisms (a per-user grant,
 * a cohort link + membership, a floor publish, and the both-granted precedence case) are
 * already CREATED by `materializeFixture` through the runtime RLS path + the live Share
 * endpoint; this only names the pieces the render spec asserts against.
 */
export async function seedShareMechanismFixture(
  tenant: KnowledgeGraphTenant
): Promise<ShareMechanismFixture> {
  const { refs, actors } = await materializeFixture(
    SHARE_MECHANISM_SCENARIO,
    tenant
  );
  const id = (ref: string): string => {
    const value = refs.get(ref);
    if (!value)
      throw new Error(`share-mechanism fixture: missing ref "${ref}"`);
    return value;
  };
  const who = (ref: string): KnowledgeActor => {
    const actor = actors.get(ref);
    if (!actor)
      throw new Error(`share-mechanism fixture: missing actor "${ref}"`);
    return actor;
  };
  return {
    spaceId: tenant.spaceId,
    folderId: id('share-mechanism/folder'),
    personalNodeId: id('share-mechanism/personal'),
    cohortNodeId: id('share-mechanism/cohort'),
    broadcastNodeId: id('share-mechanism/broadcast'),
    bothNodeId: id('share-mechanism/both'),
    expected: {
      personal: 'personal',
      cohort: 'cohort',
      broadcast: 'broadcast',
      both: 'personal',
    },
    // `admin` is the access-manager: it creates the `mech-cohort` cohort and enrols
    // `viewer` (the materializer's scope-membership write runs as `admin`).
    viewer: who('viewer'),
    owner: who('owner'),
    accessManager: who('admin'),
  };
}

// ── ADR-0021 Part A: directory-v2 paginated picker fixture ───────────────────
//
// The Wave-1 picker e2e needs a space with MORE THAN 5 grantable co-members so the
// page-of-5 people-picker can show 5 + "+N more", a keyset "Show more" next page with
// no overlap, and `p_exclude` dropping the owner + already-granted from BOTH the page
// and the `total_count`. The 4-member `per-user-share` space cannot (one page holds
// them all). This fixture draws the ten-member grantable space ENTIRELY from the shared
// `DIRECTORY_PICKER_SCENARIO` catalog entry (via `materializeFixture`) — never an inline
// member tree — so the demo DB and the picker spec build the same cohort the same way:
// members minted as active space members under RLS, their display names set own-row, the
// one pre-existing grant authored through the live Share transport (`userGrants`).

/** Member ref → display name, in directory sort order (`coalesce(display_name,email)
 * asc, user_id asc`). The picker spec asserts the first keyset page and the next page
 * against THESE names. Re-exported from the catalog so the spec and the demo agree. */
export const DIRECTORY_PICKER_NAMES = DIRECTORY_PICKER_DISPLAY_NAMES;

/** The directory-v2 picker fixture, resolved from the shared catalog scenario. */
export type DirectoryPickerFixture = {
  /** The space the ten-member grantable directory is scoped to (ADR-0021 GET param). */
  spaceId: string;
  /** The private folder containing the share target + control docs. */
  folderId: string;
  /** The private Share-target doc (owned by `owner`) whose picker offers the cohort —
   * `member03` is already granted it, so `p_exclude` must drop owner + member03 from
   * both the page and the count (9 grantable: a full page of 5 + a next page of 4). */
  sharedDocId: string;
  /** A private sibling with NO grant — its picker offers the FULL cohort (only the
   * owner is excluded): ten members across two keyset pages from a clean slate. */
  controlDocId: string;
  /** The resource OWNER (`admin`) — excluded from its own grantable directory (p_exclude). */
  owner: KnowledgeActor;
  /** The member already granted the share target — `p_exclude` must drop it from the
   * shared doc's page AND count (but it still appears in the control doc's picker). */
  grantedMember: KnowledgeActor;
  /** All ten grantable co-members, in directory sort order (keyset-page assertions). */
  members: KnowledgeActor[];
  /** Member ref → display name, in directory sort order (page-boundary assertions). */
  displayNames: typeof DIRECTORY_PICKER_DISPLAY_NAMES;
};

/**
 * Materialize the directory-v2 picker cohort over an existing tenant and project its
 * refs/actors onto the picker-spec shape. The ten members + the one pre-existing grant
 * are already CREATED by `materializeFixture` through the runtime RLS path + the live
 * Share endpoint; this only names the pieces the picker spec asserts against.
 */
export async function seedDirectoryPickerFixture(
  tenant: KnowledgeGraphTenant
): Promise<DirectoryPickerFixture> {
  const { refs, actors } = await materializeFixture(
    DIRECTORY_PICKER_SCENARIO,
    tenant
  );
  const id = (ref: string): string => {
    const value = refs.get(ref);
    if (!value)
      throw new Error(`directory-picker fixture: missing ref "${ref}"`);
    return value;
  };
  const who = (ref: string): KnowledgeActor => {
    const actor = actors.get(ref);
    if (!actor)
      throw new Error(`directory-picker fixture: missing actor "${ref}"`);
    return actor;
  };
  // In directory sort order (the display names carry a two-digit ordinal that pins the
  // `coalesce(display_name,email)` order), so `members[0..4]` is the first keyset page.
  const memberRefs = Object.keys(DIRECTORY_PICKER_DISPLAY_NAMES).sort((a, b) =>
    DIRECTORY_PICKER_DISPLAY_NAMES[a]!.localeCompare(
      DIRECTORY_PICKER_DISPLAY_NAMES[b]!
    )
  );
  return {
    spaceId: tenant.spaceId,
    folderId: id('directory-picker/folder'),
    sharedDocId: id('directory-picker/shared'),
    controlDocId: id('directory-picker/control'),
    owner: who('admin'),
    grantedMember: who('picker-member-03'),
    members: memberRefs.map(who),
    displayNames: DIRECTORY_PICKER_DISPLAY_NAMES,
  };
}

// ── ADR-0023: owner-scoped, live containment inheritance fixture ─────────────
//
// The access-matrix spec (granted folder exposes the owner's OWN descendants; owner-scope
// holds against a third party's nested node, even under an admin's folder-share; new child
// auto-appears; revoke removes the subtree; a self-granted child survives; floor + cohort
// folders inherit owner-scoped) draws its multi-owner tree ENTIRELY from the shared
// `CONTAINMENT_INHERITANCE_SCENARIO` catalog entry — no inline create helpers — so the demo
// DB and the test build the folders / containment / grants the SAME way, through the one
// `/author/graph/*` create-vocabulary. `materializeFixture` has already CREATED the tree (the
// folder grant via `grantUser`, the containment via `contain`, the floor via `setFloor`, the
// cohort link via `linkScope`); this wrapper names the refs + actors the matrix asserts, and
// the spec drives the LIVE arcs (new-child / revoke / re-grant) through the same vocabulary
// (`seedClientFor(owner).createDoc/contain/revokeUser/grantUser`).

/** The containment-inheritance fixture, resolved from the shared catalog scenario. */
export type ContainmentInheritanceFixture = {
  /** The space the multi-owner tree is scoped to. */
  spaceId: string;
  /** Folder A shares with `grantee` (private + per-user grant) — its OWN contents inherit. */
  sharedFolderId: string;
  /** A's own doc directly in the shared folder (inherits via the folder grant). */
  ownChildId: string;
  /** A's deeper subfolder under the shared folder (the >1-level walk). */
  ownSubfolderId: string;
  /** A's own grandchild two levels under the shared folder (recursive walk reaches it). */
  ownGrandchildId: string;
  /** A's child shared BOTH via the folder AND a direct grant → survives the folder revoke. */
  selfGrantedChildId: string;
  /** ownerB's node filed into A's shared folder (must NOT reach `grantee` — owner-scope). */
  foreignChildId: string;
  /** Folder owned by the ADMIN `adminC` (holds access), shared with `grantee`. */
  curatorFolderId: string;
  /** ownerB's node inside the admin's folder (no admin cascade — stays private to grantee). */
  curatorForeignChildId: string;
  /** A's space-floor folder. */
  floorFolderId: string;
  /** A's own doc under the floor folder (broadcast to the whole space). */
  floorOwnChildId: string;
  /** ownerB's node under A's floor folder (NOT broadcast — owner-scope). */
  floorForeignChildId: string;
  /** A's cohort-shared folder (scope → Cohort A). */
  cohortFolderId: string;
  /** A's own doc inside the cohort folder (inherits to Cohort A members). */
  cohortOwnChildId: string;
  /** A top-level PRIVATE, UN-SHARED A-owned doc (no grant/scope/floor, no folder ancestor) —
   * the render NEGATIVE: the Access section must show NO "shared out" badge nor inherited summary. */
  privateUnsharedId: string;
  /** Owner A (`admin`) — owns the folders + most descendants; authors the live arcs. */
  owner: KnowledgeActor;
  /** The person A shares the folder WITH — sees the owner's descendants via inheritance. */
  grantee: KnowledgeActor;
  /** A SECOND owner — its nodes filed into A's folders must NOT inherit (owner-scope). */
  ownerB: KnowledgeActor;
  /** An ADMIN (holds `space.knowledge.access`) — its folder-share does NOT cascade cross-owner. */
  adminC: KnowledgeActor;
  /** A member of Cohort A — sees A's own cohort-folder descendants via inheritance. */
  cohortMember: KnowledgeActor;
  /** NOT a member of Cohort A — the cohort-folder descendants stay hidden (fail-closed). */
  cohortStranger: KnowledgeActor;
};

/**
 * Materialize the containment-inheritance scenario over an existing tenant and project
 * its refs/actors onto the matrix-spec shape. The folder grants, the cross-owner
 * containment, the floor, and the cohort link are already CREATED by `materializeFixture`
 * through the runtime RLS path + the live endpoints; this only names the pieces.
 */
export async function seedContainmentInheritanceFixture(
  tenant: KnowledgeGraphTenant
): Promise<ContainmentInheritanceFixture> {
  const { refs, actors } = await materializeFixture(
    CONTAINMENT_INHERITANCE_SCENARIO,
    tenant
  );
  const id = (ref: string): string => {
    const value = refs.get(ref);
    if (!value)
      throw new Error(`containment-inheritance fixture: missing ref "${ref}"`);
    return value;
  };
  const who = (ref: string): KnowledgeActor => {
    const actor = actors.get(ref);
    if (!actor)
      throw new Error(
        `containment-inheritance fixture: missing actor "${ref}"`
      );
    return actor;
  };
  return {
    spaceId: tenant.spaceId,
    sharedFolderId: id('containment-inheritance/shared-folder'),
    ownChildId: id('containment-inheritance/own-child'),
    ownSubfolderId: id('containment-inheritance/own-subfolder'),
    ownGrandchildId: id('containment-inheritance/own-grandchild'),
    selfGrantedChildId: id('containment-inheritance/self-granted-child'),
    foreignChildId: id('containment-inheritance/foreign-child'),
    curatorFolderId: id('containment-inheritance/curator-folder'),
    curatorForeignChildId: id('containment-inheritance/curator-foreign-child'),
    floorFolderId: id('containment-inheritance/floor-folder'),
    floorOwnChildId: id('containment-inheritance/floor-own-child'),
    floorForeignChildId: id('containment-inheritance/floor-foreign-child'),
    cohortFolderId: id('containment-inheritance/cohort-folder'),
    cohortOwnChildId: id('containment-inheritance/cohort-own-child'),
    privateUnsharedId: id('containment-inheritance/private-unshared'),
    owner: who('admin'),
    grantee: who('grantee'),
    ownerB: who('ownerB'),
    adminC: who('adminC'),
    cohortMember: who('cohortMember'),
    cohortStranger: who('cohortStranger'),
  };
}

// ── ADR-0024 (slice-12): lexical-search corpus fixture ───────────────────────
//
// The Phase-1 search e2e (`knowledge-search.e2e.spec.ts`, the merge gate) draws its
// corpus ENTIRELY from the shared `KNOWLEDGE_BASE_SCENARIO` catalog entry (via
// `materializeFixture`) — never an inline `createDoc` tree — so the demo seed and the
// test build the multi-locale match set + the RLS-absence proof the SAME way, through
// the one `/author/graph/*` create-vocabulary (`createDoc`/`describe`/`grantUser`/
// `contain`). The fixture resolves the corpus refs + the `searcherB` actor the matrix
// asserts against, and the spec drives the search itself through the SAME vocabulary
// (`seedClientFor(actor).search` → `POST /author/graph/search`, RLS-fenced as the actor).
//
// Assertion 7 (a node in ANOTHER space stays absent) is NOT expressible in the single-
// space scenario model, so this fixture mints a SECOND ephemeral tenant and seeds one
// colliding-prefix Cyrillic node there (owned by that tenant's `granted` actor). The
// space-A searcher searches space A; RLS + the per-space scope fence the foreign node out.

/** The lexical-search corpus fixture, resolved from the shared `KNOWLEDGE_BASE_SCENARIO`
 * plus a second tenant for the other-space negative (ADR-0024 §3). Every `…Id` is a
 * `knr_…`; the spec asserts presence/absence by these named refs. */
export type SearchCorpusFixture = {
  /** Space A — the space the searcher (`admin`) browses + searches. */
  spaceId: string;
  /** Cyrillic article ('Договор аренды') — `договор` finds it (assertion 1). */
  cyrillicId: string;
  cyrillicTitle: string;
  /** Accented article ('Égérie') — `egerie` finds it via unaccent (assertion 2). */
  accentId: string;
  accentTitle: string;
  /** English article ('Getting Started') — `GETTING` finds it case-insensitively (assertion 3). */
  englishId: string;
  englishTitle: string;
  /** Cyrillic greeting ('Привет команде') — the Phase-2 `'превет'` typo target (seeded now). */
  typoTargetId: string;
  typoTargetTitle: string;
  /** 'Onboarding Guide' — `onboarding` matches its TITLE; must outrank the description-match
   * below (title > description at equal tier — Phase-2 assertion 5). */
  onboardingTitleId: string;
  onboardingTitleTitle: string;
  /** 'Workspace Setup' — `onboarding` matches only its DESCRIPTION; must rank BELOW the
   * title-match above (Phase-2 assertion 5). */
  onboardingDescriptionId: string;
  onboardingDescriptionTitle: string;
  /** Bea's PRIVATE node ('Договорённость приватная') — ABSENT from `admin`'s search (assertion 6). */
  privateOtherOwnerId: string;
  privateOtherOwnerTitle: string;
  /** A's child inside the folder shared to Bea ('Договор унаследованный') — PRESENT for
   * Bea via the inherited-grant disjunct, even though never granted directly (assertion 8). */
  inheritedChildId: string;
  inheritedChildTitle: string;
  /** The leaf doc ('Abyssal Treasure', `abyssal` in its DESCRIPTION) buried SIX levels
   * below the KB root — searching `abyssal` matches only this node; the Advanced
   * (`?view=advanced`) lens must render its full ancestor chain expanded down to it. */
  deepLeafId: string;
  deepLeafTitle: string;
  /** The distinctive term that matches ONLY the deep leaf (collides with no other
   * corpus assertion) — the query the deep-tree advanced-search spec searches for. */
  deepLeafTerm: string;
  /** The five ancestor-folder titles on the path root → leaf, OUTERMOST first
   * ('Level One' … 'Level Five') — the advanced view renders each, fully expanded. */
  deepChainFolderTitles: [string, string, string, string, string];
  /** The five ancestor-folder ids on the path root → leaf, OUTERMOST first. */
  deepChainFolderIds: [string, string, string, string, string];
  /** The searcher (`admin`, owner of the corpus) — the primary acting user. */
  searcher: KnowledgeActor;
  /** A second owner in the SAME space: owns the private negative; the grantee of the
   * inherited folder (so its child surfaces in Bea's search via inheritance). */
  searcherB: KnowledgeActor;
  /** Space B — a DIFFERENT space holding a colliding-prefix node (assertion 7). */
  otherSpace: {
    tenant: KnowledgeGraphTenant;
    /** A node in space B whose title prefix-matches `договор` — must NOT appear in a
     * space-A search (per-space scope + RLS fence it out). */
    nodeId: string;
    nodeTitle: string;
  };
};

/** A node in space B whose title shares the `договор` prefix the searcher queries — so
 * its ABSENCE proves the fence is the space scope + RLS, not the term not matching. */
const OTHER_SPACE_SEARCH_TITLE = 'Договор другого пространства';

/**
 * Materialize the search corpus over space A (the shared `KNOWLEDGE_BASE_SCENARIO`) and
 * mint a second tenant (space B) carrying one colliding-prefix node for the other-space
 * negative. The corpus + grants are CREATED by `materializeFixture` through the runtime
 * RLS path + the live endpoints; the space-B node is created AS that tenant's `granted`
 * actor through the shared `createDoc` vocabulary. Returns the named refs/actors the spec
 * asserts against. Pair with `teardownSearchCorpusFixture` (it tears down space B).
 */
export async function seedSearchCorpusFixture(
  tenant: KnowledgeGraphTenant
): Promise<SearchCorpusFixture> {
  const { refs, actors } = await materializeFixture(
    KNOWLEDGE_BASE_SCENARIO,
    tenant
  );
  const id = (ref: string): string => {
    const value = refs.get(ref);
    if (!value) throw new Error(`search-corpus fixture: missing ref "${ref}"`);
    return value;
  };
  const who = (ref: string): KnowledgeActor => {
    const actor = actors.get(ref);
    if (!actor)
      throw new Error(`search-corpus fixture: missing actor "${ref}"`);
    return actor;
  };

  // Space B: a SECOND tenant whose `granted` actor owns one node sharing the `договор`
  // prefix the searcher queries. The space-A searcher is not a member of space B, and
  // the search is per-space-scoped, so RLS never returns this row to a space-A search.
  const otherTenant = await bootstrapEphemeralTenant();
  const otherClient = await seedClientFor(otherTenant.granted);
  const otherNode = await otherClient.createDoc(
    otherTenant.spaceId,
    OTHER_SPACE_SEARCH_TITLE
  );
  await otherClient.publishDoc(otherTenant.spaceId, otherNode.nodeId);

  return {
    spaceId: tenant.spaceId,
    cyrillicId: id('kb/lease-cyrillic'),
    cyrillicTitle: 'Договор аренды',
    accentId: id('kb/egerie-accent'),
    accentTitle: 'Égérie',
    englishId: id('kb/getting-started'),
    englishTitle: 'Getting Started',
    typoTargetId: id('kb/greeting-typo'),
    typoTargetTitle: 'Привет команде',
    onboardingTitleId: id('kb/onboarding-title'),
    onboardingTitleTitle: 'Onboarding Guide',
    onboardingDescriptionId: id('kb/onboarding-description'),
    onboardingDescriptionTitle: 'Workspace Setup',
    privateOtherOwnerId: id('kb/private-other-owner'),
    privateOtherOwnerTitle: 'Договорённость приватная',
    inheritedChildId: id('kb/inherited-child'),
    inheritedChildTitle: 'Договор унаследованный',
    deepLeafId: id('kb/deep/leaf'),
    deepLeafTitle: 'Abyssal Treasure',
    deepLeafTerm: 'abyssal',
    deepChainFolderTitles: [
      'Level One',
      'Level Two',
      'Level Three',
      'Level Four',
      'Level Five',
    ],
    deepChainFolderIds: [
      id('kb/deep/level-1'),
      id('kb/deep/level-2'),
      id('kb/deep/level-3'),
      id('kb/deep/level-4'),
      id('kb/deep/level-5'),
    ],
    searcher: who('admin'),
    searcherB: who('searcherB'),
    otherSpace: {
      tenant: otherTenant,
      nodeId: otherNode.nodeId,
      nodeTitle: OTHER_SPACE_SEARCH_TITLE,
    },
  };
}

/** Tear down the search corpus's SECOND tenant (space B). Space A is the caller's main
 * tenant, torn down by the spec via `teardownKnowledgeGraphTenant`; here we only release
 * the ephemeral space-B tenant the fixture minted for the other-space negative. */
export async function teardownSearchCorpusFixture(
  fx: SearchCorpusFixture | undefined
): Promise<void> {
  if (fx?.otherSpace?.tenant) {
    await teardownKnowledgeGraphTenant(fx.otherSpace.tenant);
  }
}

// ── ADR-0026 (slice-13): KB media substrate fixture (the merge gate) ─────────
//
// The media e2e (`knowledge-media-substrate.e2e.spec.ts`) drives the REAL signed-upload/
// download transport (`/author/graph/media` + `attribute:'media'`) against REAL Storage,
// RLS-fenced as each acting user — never a service-role/direct-SQL insert of media. The
// seeded corpus comes ENTIRELY from the shared `KNOWLEDGE_BASE_SCENARIO` (the `media`
// preset), so the demo DB and the test make `file`/`video` nodes real the SAME way, through
// the one create-vocabulary (the materializer's `uploadNodeMedia`: authorize → PUT via
// `uploadToSignedUrl` → confirm the `kmm` satellite). This wrapper resolves the named node
// refs + actors + the seeded storage paths (read via the tenant's service client, for the
// direct-object-fetch negatives), and mints a SECOND tenant for the cross-space negative
// (assertion 7 — not expressible in the single-space scenario model).

/** The KB bucket the substrate stores bytes in — re-exported so the spec fetches objects
 * directly (the no-signed-token / anon negatives) against the SAME bucket the seed uses. */
export const MEDIA_BUCKET = KB_MEDIA_BUCKET;

/** The exact fixture bytes the KB scenario seeds per node (kept in sync with
 * `knowledge-base.ts`) — the download round-trip (assertion 2) asserts the bytes returned
 * by the signed URL equal THESE. */
export const MEDIA_FIXTURE_BYTES = {
  fileOwned:
    'ProFlow KB media fixture — the generic file substrate (ADR-0026).\nThese bytes travel the real signed-upload transport into the private kb-media bucket.\nDownloaded via a short-lived signed URL; the same exact bytes come back.\n',
  videoOwned:
    'ProFlow KB media fixture — a "video" node over the SAME substrate (ADR-0026).\nOne generic satellite + one bucket serves file AND video; the player is a later slice.\n',
  inherited:
    'ProFlow KB media fixture — an attachment inherited through a shared ancestor folder (ADR-0023 + ADR-0026).\nThe grantee reaches these bytes with no direct grant on the file itself.\n',
  nodeGrant:
    'ProFlow KB media fixture — the OWNER uploaded these bytes; a read-grantee may DOWNLOAD but never OVERWRITE them (ADR-0026 write-fence).\n',
} as const;

/** The KB media substrate fixture, resolved from the shared `KNOWLEDGE_BASE_SCENARIO`
 * plus a second tenant for the cross-space negative (ADR-0026 §3). Every `…Id` is a
 * `knr_…`; storage paths are the seeded `kmm.storage_path` (for the direct-fetch fences). */
export type MediaSubstrateFixture = {
  /** Space A — the space the owner (`admin`) authors + downloads in. */
  spaceId: string;
  /** The `Knowledge Base` folder that contains the owned file/video — the browser
   * opens `?folder=<this>` to reach the file card + its ResourcePanel (assertion 3). */
  kbFolderId: string;
  /** Owned file (real bytes) — the functional happy path (assertions 1–3). */
  fileOwnedId: string;
  fileOwnedPath: string;
  /** Owned video (real bytes) — one substrate serves file & video (assertion 4). */
  videoOwnedId: string;
  videoOwnedPath: string;
  /** Owned IMAGE (real PNG bytes, `image/png`) — the inline `<img>` preview happy path
   * (ADR-0026 Phase 2, increment 1). Its filename powers the `alt="Preview of <name>"`. */
  fileImageId: string;
  fileImageFilename: string;
  /** Owned PDF (real bytes, `application/pdf`) — the inline `<iframe>` preview path
   * (ADR-0026 Phase 2, increment 1). Its filename powers the `title="Preview of <name>"`. */
  filePdfId: string;
  filePdfFilename: string;
  /** A REAL file (owner-uploaded bytes) per-user-granted to `nodeGrantee` (a node-only
   * member) — the read/write asymmetry (assertions 11a/11b): the read-grant lets the
   * grantee DOWNLOAD (11a) but the write fence blocks the grantee's UPLOAD (11b). */
  nodeGrantFileId: string;
  /** The seeded storage path of `nodeGrantFile` — for the 11b direct-upload-attempt fence. */
  nodeGrantFilePath: string;
  /** Bea's PRIVATE file (real bytes) — the download RLS-negative (assertions 5, 6). */
  privateOtherFileId: string;
  privateOtherFilePath: string;
  /** A file nested under the ancestor-shared folder (real bytes) — the inherited-grant
   * download positive for `otherOwner` (assertion 8). */
  inheritedFileId: string;
  inheritedFilePath: string;
  /** The owner of the corpus (`admin`) — authors + downloads its own media. */
  owner: KnowledgeActor;
  /** A SECOND owner (`searcherB`, `admin` role): owns the private file; the grantee of
   * the ancestor-shared folder (so its nested file downloads via inheritance). */
  otherOwner: KnowledgeActor;
  /** A NODE-ONLY member (`member` role — read + create, NO space-wide update) granted
   * `nodeGrantFile` per-user: the read-grant lets it DOWNLOAD (11a); the write fence
   * (owner-or-space-update, grants NOT composed) DENIES its UPLOAD (11b). */
  nodeGrantee: KnowledgeActor;
  /** The exact seeded bytes per node (download round-trip, assertion 2). */
  fixtureBytes: typeof MEDIA_FIXTURE_BYTES;
  /** Space B — a DIFFERENT space holding a real file the space-A owner cannot reach
   * (assertion 7 — cross-space download denial). */
  otherSpace: {
    tenant: KnowledgeGraphTenant;
    /** A real file node in space B (owned by that tenant's `granted` actor). */
    fileId: string;
  };
};

/** Read a node's seeded media storage path from the `kb.resource_media_meta` satellite
 * (service client — a setup/assertion read, NOT the access path under test). */
async function mediaStoragePath(
  tenant: KnowledgeGraphTenant,
  nodeId: string
): Promise<string> {
  const { data, error } = await tenant.service
    .schema('kb')
    .from('resource_media_meta')
    .select('storage_path')
    .eq('node_id', nodeId)
    .single();
  if (error || !data?.storage_path) {
    throw new Error(
      `media fixture: no kmm.storage_path for ${nodeId} — ${error?.message ?? 'no row'}`
    );
  }
  return data.storage_path;
}

/**
 * Materialize the KB media substrate over space A (the shared `KNOWLEDGE_BASE_SCENARIO`,
 * whose `media` nodes are uploaded through the real transport by the materializer) and mint
 * a second tenant (space B) carrying one real file for the cross-space negative. Returns the
 * named refs/actors + storage paths the media matrix asserts against. Pair with
 * `teardownMediaSubstrateFixture` (it tears down space B).
 */
export async function seedMediaSubstrateFixture(
  tenant: KnowledgeGraphTenant
): Promise<MediaSubstrateFixture> {
  const { refs, actors } = await materializeFixture(
    KNOWLEDGE_BASE_SCENARIO,
    tenant
  );
  const id = (ref: string): string => {
    const value = refs.get(ref);
    if (!value) throw new Error(`media fixture: missing ref "${ref}"`);
    return value;
  };
  const who = (ref: string): KnowledgeActor => {
    const actor = actors.get(ref);
    if (!actor) throw new Error(`media fixture: missing actor "${ref}"`);
    return actor;
  };

  const fileOwnedId = id('kb/file-owned');
  const videoOwnedId = id('kb/video-owned');
  const fileImageId = id('kb/file-image');
  const filePdfId = id('kb/file-pdf');
  const privateOtherFileId = id('kb/file-private-other');
  const inheritedFileId = id('kb/inherited-file');
  const nodeGrantFileId = id('kb/file-node-grant');

  // Space B: a second tenant whose `granted` actor owns one real file the space-A owner
  // is not a member of — the cross-space download denial (assertion 7). Uploaded through
  // the SAME real transport so its bytes genuinely exist (denial ≠ missing object).
  const otherTenant = await bootstrapEphemeralTenant();
  const otherClient = await seedClientFor(otherTenant.granted);
  const otherFileId = await otherClient.createNode(
    otherTenant.spaceId,
    'file',
    'Cross-Space File'
  );
  const otherContent =
    'ProFlow KB media fixture — a file in ANOTHER space (ADR-0026 assertion 7).\n';
  const otherSize = new TextEncoder().encode(otherContent).byteLength;
  const otherAuth = await otherClient.uploadMediaUrl(
    otherTenant.spaceId,
    otherFileId,
    {
      mimeType: 'text/plain',
      sizeBytes: otherSize,
      filename: 'cross-space.txt',
    }
  );
  const { error: otherUploadErr } = await otherTenant.granted.client.storage
    .from(KB_MEDIA_BUCKET)
    .uploadToSignedUrl(
      otherAuth.storagePath,
      otherAuth.token ?? '',
      new Blob([otherContent], { type: 'text/plain' })
    );
  if (otherUploadErr) {
    throw new Error(`media fixture space-B upload: ${otherUploadErr.message}`);
  }
  await otherClient.setMedia({
    spaceId: otherTenant.spaceId,
    nodeId: otherFileId,
    storagePath: otherAuth.storagePath,
    mimeType: 'text/plain',
    sizeBytes: otherSize,
    originalFilename: 'cross-space.txt',
  });
  await otherClient.dispose();

  return {
    spaceId: tenant.spaceId,
    kbFolderId: id('kb/folder'),
    fileOwnedId,
    fileOwnedPath: await mediaStoragePath(tenant, fileOwnedId),
    videoOwnedId,
    videoOwnedPath: await mediaStoragePath(tenant, videoOwnedId),
    fileImageId,
    fileImageFilename: 'media-preview.png',
    filePdfId,
    filePdfFilename: 'media-preview.pdf',
    nodeGrantFileId,
    nodeGrantFilePath: await mediaStoragePath(tenant, nodeGrantFileId),
    privateOtherFileId,
    privateOtherFilePath: await mediaStoragePath(tenant, privateOtherFileId),
    inheritedFileId,
    inheritedFilePath: await mediaStoragePath(tenant, inheritedFileId),
    owner: who('admin'),
    otherOwner: who('searcherB'),
    nodeGrantee: who('mediaGrantee'),
    fixtureBytes: MEDIA_FIXTURE_BYTES,
    otherSpace: { tenant: otherTenant, fileId: otherFileId },
  };
}

/** Tear down the media fixture's SECOND tenant (space B). Space A is the caller's main
 * tenant (torn down by the spec); here we only release the ephemeral space-B tenant. */
export async function teardownMediaSubstrateFixture(
  fx: MediaSubstrateFixture | undefined
): Promise<void> {
  if (fx?.otherSpace?.tenant) {
    await teardownKnowledgeGraphTenant(fx.otherSpace.tenant);
  }
}
