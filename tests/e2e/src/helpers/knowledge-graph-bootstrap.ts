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
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  resolveAnonKey,
  resolveServiceRoleKey,
  resolveSupabaseUrl,
} from './test-user.js';

// ── slice-03: HTTP auth for the fan-out endpoints ─────────────────────────────
//
// The `/author/graph/*` endpoints build the user's RLS-scoped client from the
// `@supabase/ssr` cookie. To drive them over HTTP as an actor, write that exact
// SSR cookie by replaying the actor's session through `@supabase/ssr`'s OWN
// `createServerClient` against an in-memory cookie jar — guaranteeing the
// byte-exact name + base64url chunk encoding the proxy reads back.

/** Sign in an actor and return the `@supabase/ssr` auth cookies (name+value). */
export async function actorSsrAuthCookies(
  actor: KnowledgeActor
): Promise<{ name: string; value: string }[]> {
  // 1. Programmatic sign-in to obtain a session.
  const signer = createClient(resolveSupabaseUrl(), resolveAnonKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await signer.auth.signInWithPassword({
    email: actor.email,
    password: actor.password,
  });
  if (error || !data.session) {
    throw new Error(`actorSsrAuthCookies: ${error?.message ?? 'no session'}`);
  }

  // 2. Replay the session through @supabase/ssr so it serializes the cookies in
  //    the exact format the author proxy/endpoints decode (name + base64url).
  const jar = new Map<string, string>();
  const ssr = createServerClient(resolveSupabaseUrl(), resolveAnonKey(), {
    cookies: {
      getAll() {
        return [...jar.entries()].map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet: { name: string; value: string }[]) {
        for (const { name, value } of cookiesToSet) {
          jar.set(name, value);
        }
      },
    },
  });
  await ssr.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });

  if (jar.size === 0) {
    throw new Error('actorSsrAuthCookies: ssr wrote no cookies');
  }
  return [...jar.entries()].map(([name, value]) => ({ name, value }));
}

// ── Types ────────────────────────────────────────────────────────────────────

export type KnowledgeActor = {
  userId: string;
  email: string;
  password: string;
  /** Authenticated client (user JWT) — subject to RLS. */
  client: SupabaseClient;
};

export type KnowledgeGraphTenant = {
  organizationId: string;
  spaceId: string;
  /** Actor holding the `admin` space role → has `space.knowledge.*`. */
  granted: KnowledgeActor;
  /** Actor holding only `space_admin` → no knowledge verbs. */
  ungranted: KnowledgeActor;
  /** Service-role client — bypasses RLS (for setup/assertions). */
  service: SupabaseClient;
};

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

// ── Shared ProjectionSpec builders (single source of truth) ──────────────────
//
// ONE definition of each spec, reused by BOTH the Invariant #1 seeding and the
// projection-engine seeding, so the saved specs can never drift apart again.
//
// Variant B: "has tag T" is an INCOMING `tagged` traversal that starts at the
// tag node, NOT a `{field:'tag'}` filter leaf (that field was removed from the
// contract). The projection filter is scalar-only (`kind in (text, link)`).

/** KB ProjectionSpec — tag membership via incoming `tagged` traversal (Variant B). */
export function buildKnowledgeBaseSpec(tagNodeId: string) {
  return {
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
  } as const;
}

/** Course ProjectionSpec — outgoing `prerequisite` walk over the SAME graph. */
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

/**
 * Board ProjectionSpec — slice-06 third vertical, landed as PURE configuration.
 * Selects the document nodes (incoming `tagged` traversal from the 'Docs' tag,
 * Variant B — the same mechanism the KB grid uses, not a new filter field) and
 * DECLARES the `requires_state` gating rule: a node is available iff its status
 * is in `{ approved }`. The rule is DISPLAY gating (ADR-0006 §2): every node
 * stays in `items`; only `available` changes.
 */
export function buildBoardSpec(docsTagNodeId: string) {
  return {
    schema_version: 1,
    filter: { field: 'kind', op: 'in', value: ['text', 'link'] },
    traversal: {
      start: { ids: [docsTagNodeId] },
      relation_types: ['tagged'],
      direction: 'incoming',
      max_depth: 1,
      order_by: 'title',
    },
    view: 'board',
    gating: { rule: 'requires_state', params: { allowed: ['approved'] } },
  } as const;
}

/**
 * Lens ProjectionSpec — the saved canvas slice the lens navigator renders. It is
 * the SAME mechanism as the KB grid (Variant B: incoming `tagged` traversal from
 * a tag node, `kind in (text,link)` filter); only `view='lens'` differs. The lens
 * navigator layers the hub rail + bounded neighborhood expansion (resolveNeighborhood)
 * + resource panel ON TOP of this resolved set — the slice itself is just a
 * projection (Invariant #1: a new view is data, never a new query path).
 */
export function buildLensSpec(tagNodeId: string) {
  return {
    schema_version: 1,
    filter: { field: 'kind', op: 'in', value: ['text', 'link'] },
    traversal: {
      start: { ids: [tagNodeId] },
      relation_types: ['tagged'],
      direction: 'incoming',
      max_depth: 1,
      order_by: 'title',
    },
    view: 'lens',
  } as const;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function serviceSupabase(): SupabaseClient {
  return createClient(resolveSupabaseUrl(), resolveServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function slug(): string {
  return `kg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createActor(
  service: SupabaseClient,
  label: string
): Promise<{ id: string; email: string; password: string }> {
  const suffix = `${label}-${slug()}`;
  const email = `e2e-${suffix}@example.test`;
  const password = `Pw!${suffix}Aa9`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`createActor(${label}): ${error?.message ?? 'no user'}`);
  }
  return { id: data.user.id, email, password };
}

async function authenticatedClient(
  email: string,
  password: string
): Promise<SupabaseClient> {
  const client = createClient(resolveSupabaseUrl(), resolveAnonKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`authenticatedClient: ${error.message}`);
  }
  return client;
}

async function resolveRoleIds(
  service: SupabaseClient
): Promise<{ adminRoleId: string; spaceAdminRoleId: string }> {
  const { data, error } = await service
    .from('roles')
    .select('id,key')
    .eq('role_kind', 'system')
    .in('key', ['admin', 'space_admin']);
  if (error) {
    throw new Error(`resolveRoleIds: ${error.message}`);
  }
  const byKey = new Map((data ?? []).map((r) => [r.key, r.id]));
  const adminRoleId = byKey.get('admin');
  const spaceAdminRoleId = byKey.get('space_admin');
  if (!adminRoleId || !spaceAdminRoleId) {
    throw new Error(
      'resolveRoleIds: system roles admin/space_admin not found — knowledge perms unmapped'
    );
  }
  return { adminRoleId, spaceAdminRoleId };
}

/**
 * Resolve the base `member` space system role id. Every space member receives
 * this role by default; the knowledge member-grant migration maps the full
 * knowledge verb-set (read/create/update/delete/transition) onto it, so a
 * `member` actor can author the graph with ZERO special grants — the all-roles
 * RLS floor (ADR-0011 §6).
 */
async function resolveMemberRoleId(service: SupabaseClient): Promise<string> {
  const { data, error } = await service
    .from('roles')
    .select('id')
    .eq('role_kind', 'system')
    .eq('key', 'member')
    .is('owner_organization_id', null)
    .single();
  if (error || !data?.id) {
    throw new Error(
      `resolveMemberRoleId: system role 'member' not found — knowledge member grant unmapped`
    );
  }
  return data.id;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Create an org + space + two actors. Grants the knowledge `admin` role to the
 * first actor and `space_admin` only to the second. Both are space members.
 */
export async function bootstrapKnowledgeGraphTenant(): Promise<KnowledgeGraphTenant> {
  const service = serviceSupabase();
  const s = slug();

  const grantedUser = await createActor(service, 'granted');
  const ungrantedUser = await createActor(service, 'ungranted');

  const { data: org, error: orgErr } = await service
    .from('organizations')
    .insert({ name: `E2E KG Org ${s}`, slug: s })
    .select('id')
    .single();
  if (orgErr || !org?.id) {
    throw new Error(`bootstrap org: ${orgErr?.message ?? 'no id'}`);
  }

  const { data: space, error: spErr } = await service
    .from('spaces')
    .insert({
      organization_id: org.id,
      name: 'E2E KG Space',
      slug: `spc-${s}`,
    })
    .select('id')
    .single();
  if (spErr || !space?.id) {
    throw new Error(`bootstrap space: ${spErr?.message ?? 'no id'}`);
  }

  // Both actors are org + space members (audience), then differ by role grant.
  const { error: omErr } = await service
    .from('organization_memberships')
    .insert([
      { organization_id: org.id, user_id: grantedUser.id },
      { organization_id: org.id, user_id: ungrantedUser.id },
    ]);
  if (omErr) throw new Error(`bootstrap org_membership: ${omErr.message}`);

  const { error: smErr } = await service.from('space_memberships').insert([
    { space_id: space.id, user_id: grantedUser.id, status: 'active' },
    { space_id: space.id, user_id: ungrantedUser.id, status: 'active' },
  ]);
  if (smErr) throw new Error(`bootstrap space_membership: ${smErr.message}`);

  const { adminRoleId, spaceAdminRoleId } = await resolveRoleIds(service);

  // granted → `admin` (carries space.knowledge.*); ungranted → `space_admin` only.
  const { error: urErr } = await service.from('user_role').insert([
    { user_id: grantedUser.id, space_id: space.id, role_id: adminRoleId },
    {
      user_id: ungrantedUser.id,
      space_id: space.id,
      role_id: spaceAdminRoleId,
    },
  ]);
  if (urErr) throw new Error(`bootstrap user_role: ${urErr.message}`);

  const grantedClient = await authenticatedClient(
    grantedUser.email,
    grantedUser.password
  );
  const ungrantedClient = await authenticatedClient(
    ungrantedUser.email,
    ungrantedUser.password
  );

  return {
    organizationId: org.id,
    spaceId: space.id,
    granted: {
      userId: grantedUser.id,
      email: grantedUser.email,
      password: grantedUser.password,
      client: grantedClient,
    },
    ungranted: {
      userId: ungrantedUser.id,
      email: ungrantedUser.email,
      password: ungrantedUser.password,
      client: ungrantedClient,
    },
    service,
  };
}

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
  /** A node linked to scope-A: visible to members only (cohort hides it). */
  cohortRestrictedNodeId: string;
  cohortRestrictedTitle: string;
  /** A node with NO scope link: visible to everyone with read (scope_gate=true). */
  unrestrictedNodeId: string;
  unrestrictedTitle: string;
  /** A node owned by `subordinate`, restricted to an empty cohort: hierarchy-only visibility. */
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
 *  - a cohort scope-B with NOBODY enrolled (isolates the hierarchy branch: a node
 *    restricted to scope-B fails the (base AND scope) branch for everyone, so only
 *    the hierarchy OR-branch can reveal it);
 *  - a `reporting_lines` chain managerOfManager → manager → subordinate;
 *  - four demo nodes tagged into an 'Access KB' tag:
 *      • cohortRestricted — linked to scope-A (cohort hides it from non-members);
 *      • unrestricted — no scope link, default-visible to all space members;
 *      • hierarchy — owned by `subordinate` AND restricted to scope-B (nobody is a
 *        member), so it surfaces ONLY through the manager-hierarchy branch;
 *      • composed — scope-A-restricted AND owned by `subordinate` (composition:
 *        cohort member sees via scope, manager sees via hierarchy, stranger neither);
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
    })
    .select('id')
    .single();
  if (tagErr || !tag?.id) {
    throw new Error(`seedAccessLayerDemo tag: ${tagErr?.message ?? 'no id'}`);
  }
  const tagNodeId = tag.id;

  const { data: nodes, error: nodesErr } = await db
    .from('knowledge_resources')
    .insert([
      {
        space_id: spaceId,
        kind: 'text',
        title: cohortRestrictedTitle,
        status: 'active',
        created_by: granted.userId,
        owner_user_id: granted.userId,
      },
      {
        space_id: spaceId,
        kind: 'text',
        title: unrestrictedTitle,
        status: 'active',
        created_by: granted.userId,
        owner_user_id: granted.userId,
      },
      {
        space_id: spaceId,
        kind: 'text',
        title: hierarchyTitle,
        status: 'active',
        created_by: granted.userId,
        owner_user_id: actors.subordinate.userId,
      },
      {
        space_id: spaceId,
        kind: 'text',
        title: composedTitle,
        status: 'active',
        created_by: granted.userId,
        owner_user_id: actors.subordinate.userId,
      },
    ])
    .select('id,title');
  if (nodesErr || !nodes || nodes.length !== 4) {
    throw new Error(
      `seedAccessLayerDemo nodes: ${nodesErr?.message ?? 'count'}`
    );
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
  const { error: edgeErr } = await db.from('knowledge_edges').insert(
    [
      cohortRestrictedNodeId,
      unrestrictedNodeId,
      hierarchyNodeId,
      composedNodeId,
    ].map((nodeId, i) => ({
      space_id: spaceId,
      from_id: nodeId,
      to_id: tagNodeId,
      relation_type: 'tagged',
      position: i,
      created_by: granted.userId,
    }))
  );
  if (edgeErr)
    throw new Error(`seedAccessLayerDemo tagged: ${edgeErr.message}`);

  // ── cohort links ───────────────────────────────────────────────────────────
  //  - cohortRestricted + composed → scope-A (cohortMember is a member);
  //  - hierarchy → scope-B (NO members), so its (base AND scope) branch fails for
  //    everyone and it can surface ONLY through the manager-hierarchy OR-branch.
  const { error: krsErr } = await db.from('knowledge_resource_scopes').insert([
    {
      resource_id: cohortRestrictedNodeId,
      scope_id: scopeAId,
      linked_by: granted.userId,
    },
    {
      resource_id: composedNodeId,
      scope_id: scopeAId,
      linked_by: granted.userId,
    },
    {
      resource_id: hierarchyNodeId,
      scope_id: scopeBId,
      linked_by: granted.userId,
    },
  ]);
  if (krsErr)
    throw new Error(`seedAccessLayerDemo resource_scopes: ${krsErr.message}`);

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

// ── slice-09: lens-view demo (hub rail + neighborhood expansion + panel) ─────
//
// The lens navigator lands as PURE CONFIGURATION over the SAME graph primitives:
// a `lens` view_types row + a saved lens projection (the canvas slice) + a
// node/edge graph rich enough to exercise the two read ports — hub-seeding
// (loadHubNodes, degree ≥ 2) and bounded neighborhood expansion
// (resolveNeighborhood over relates_to/tagged/part_of). ZERO new tables, ZERO
// engine/resolver fork — added entirely as harness data (the identity-sync
// lesson: demo nodes/projections/edges are never migration-seeded).
//
// Graph shape (all kind text/link/tag, all edges over the same tables):
//   • content nodes A,B,C,D (text) + one link node E,
//   • tag nodes 'Lens KB' and 'Topic',
//   • `tagged` edges: A,B,C,D,E → 'Lens KB'; A,B → 'Topic',
//   • `relates_to` edges: A↔B (A→B and B→A to exercise the cycle-guard), B→C, A→C,
//   • `part_of` chain: C part_of B part_of A (parent panel),
//   • HUBS (degree ≥ 2 over relates_to ⊕ tagged): A (tagged×2 + relates_to×3),
//     B (tagged×2 + relates_to×3), C (tagged×1 + relates_to×3) — content nodes,
//     so the rail root surfaces content hubs, not tags (§3.0 recommendation).

export type LensViewGraph = {
  /** Content node A — top hub (highest degree), root candidate of the rail. */
  hubAId: string;
  hubATitle: string;
  /** Content node B — hub; relates_to A both ways (cycle-guard exercise). */
  hubBId: string;
  hubBTitle: string;
  /** Content node C — hub; child of B (part_of). */
  hubCId: string;
  hubCTitle: string;
  /** Content node D — low-degree leaf (tagged into 'Lens KB' only). */
  leafDId: string;
  leafDTitle: string;
  /** Link node E — tagged into 'Lens KB' (kind=link in the canvas slice). */
  linkEId: string;
  linkETitle: string;
  /** 'Lens KB' tag node — start of the saved lens projection slice. */
  kbTagNodeId: string;
  /** 'Topic' tag node — second tag for the tag-facet (A,B carry it). */
  topicTagNodeId: string;
  lensProjectionId: string;
};

/**
 * Ensure the `lens` view_types row exists (service-role; global reference data).
 * The slice-09 migration seeds it, but the harness mirrors the `board` pattern so
 * the demo is self-sufficient even before that migration is applied. `projections.view`
 * is FK-checked against `view_types(key)`, so the row must exist before a lens
 * projection can be inserted. Idempotent.
 */
async function ensureLensViewType(service: SupabaseClient): Promise<void> {
  const { error } = await service.from('view_types').upsert(
    {
      key: 'lens',
      label: 'Lens',
      description:
        'Node+edge navigator: hub rail, kind/tag slice and resource panel.',
    },
    { onConflict: 'key' }
  );
  if (error) {
    throw new Error(`ensureLensViewType: ${error.message}`);
  }
}

/**
 * Seed the slice-09 lens demo over the existing tenant, AS the granted actor
 * (every write passes RLS `with check`). Builds the node/edge graph described
 * above + a saved lens projection. The hub-seeding (loadHubNodes) and bounded
 * neighborhood expansion (resolveNeighborhood) read ports navigate THIS graph;
 * the resource panel reads one node's depth-1 neighborhood over the same edges.
 */
export async function seedLensViewDemo(
  tenant: KnowledgeGraphTenant
): Promise<LensViewGraph> {
  const { granted, spaceId, service } = tenant;
  const db = granted.client;

  await ensureLensViewType(service);

  const hubATitle = 'Lens Node A — Hub';
  const hubBTitle = 'Lens Node B — Hub';
  const hubCTitle = 'Lens Node C — Child';
  const leafDTitle = 'Lens Node D — Leaf';
  const linkETitle = 'Lens Node E — Link';

  const { data: contentNodes, error: nodesErr } = await db
    .from('knowledge_resources')
    .insert([
      {
        space_id: spaceId,
        kind: 'text',
        title: hubATitle,
        status: 'active',
        created_by: granted.userId,
        owner_user_id: granted.userId,
      },
      {
        space_id: spaceId,
        kind: 'text',
        title: hubBTitle,
        status: 'active',
        created_by: granted.userId,
        owner_user_id: granted.userId,
      },
      {
        space_id: spaceId,
        kind: 'text',
        title: hubCTitle,
        status: 'active',
        created_by: granted.userId,
        owner_user_id: granted.userId,
      },
      {
        space_id: spaceId,
        kind: 'text',
        title: leafDTitle,
        status: 'active',
        created_by: granted.userId,
        owner_user_id: granted.userId,
      },
      {
        space_id: spaceId,
        kind: 'link',
        title: linkETitle,
        status: 'active',
        created_by: granted.userId,
        owner_user_id: granted.userId,
      },
    ])
    .select('id,title');
  if (nodesErr || !contentNodes || contentNodes.length !== 5) {
    throw new Error(`seedLensViewDemo nodes: ${nodesErr?.message ?? 'count'}`);
  }
  const byTitle = new Map(contentNodes.map((n) => [n.title, n.id]));
  const hubAId = byTitle.get(hubATitle);
  const hubBId = byTitle.get(hubBTitle);
  const hubCId = byTitle.get(hubCTitle);
  const leafDId = byTitle.get(leafDTitle);
  const linkEId = byTitle.get(linkETitle);
  if (!hubAId || !hubBId || !hubCId || !leafDId || !linkEId) {
    throw new Error('seedLensViewDemo nodes: title ids missing');
  }

  // tag nodes (graph nodes, not column values — Variant B).
  const { data: tags, error: tagErr } = await db
    .from('knowledge_resources')
    .insert([
      {
        space_id: spaceId,
        kind: 'tag',
        title: 'Lens KB',
        status: 'active',
        created_by: granted.userId,
        owner_user_id: granted.userId,
      },
      {
        space_id: spaceId,
        kind: 'tag',
        title: 'Topic',
        status: 'active',
        created_by: granted.userId,
        owner_user_id: granted.userId,
      },
    ])
    .select('id,title');
  if (tagErr || !tags || tags.length !== 2) {
    throw new Error(`seedLensViewDemo tags: ${tagErr?.message ?? 'count'}`);
  }
  const tagByTitle = new Map(tags.map((t) => [t.title, t.id]));
  const kbTagNodeId = tagByTitle.get('Lens KB');
  const topicTagNodeId = tagByTitle.get('Topic');
  if (!kbTagNodeId || !topicTagNodeId) {
    throw new Error('seedLensViewDemo tags: title ids missing');
  }

  // `tagged` edges (resource → tag): all five content nodes into 'Lens KB';
  // A,B also into 'Topic' (second tag-facet). Canonical direction from=resource.
  const taggedEdges = [
    { from: hubAId, to: kbTagNodeId, position: 0 },
    { from: hubBId, to: kbTagNodeId, position: 1 },
    { from: hubCId, to: kbTagNodeId, position: 2 },
    { from: leafDId, to: kbTagNodeId, position: 3 },
    { from: linkEId, to: kbTagNodeId, position: 4 },
    { from: hubAId, to: topicTagNodeId, position: 0 },
    { from: hubBId, to: topicTagNodeId, position: 1 },
  ];
  // `relates_to` edges (associative): A→B and B→A (cycle), B→C, A→C.
  const relatesEdges = [
    { from: hubAId, to: hubBId, position: 0 },
    { from: hubBId, to: hubAId, position: 0 },
    { from: hubBId, to: hubCId, position: 1 },
    { from: hubAId, to: hubCId, position: 1 },
  ];
  // `part_of` chain (child → parent): C part_of B, B part_of A.
  const partOfEdges = [
    { from: hubCId, to: hubBId, position: 0 },
    { from: hubBId, to: hubAId, position: 0 },
  ];

  const { error: edgeErr } = await db.from('knowledge_edges').insert([
    ...taggedEdges.map((e) => ({
      space_id: spaceId,
      from_id: e.from,
      to_id: e.to,
      relation_type: 'tagged',
      position: e.position,
      created_by: granted.userId,
    })),
    ...relatesEdges.map((e) => ({
      space_id: spaceId,
      from_id: e.from,
      to_id: e.to,
      relation_type: 'relates_to',
      position: e.position,
      created_by: granted.userId,
    })),
    ...partOfEdges.map((e) => ({
      space_id: spaceId,
      from_id: e.from,
      to_id: e.to,
      relation_type: 'part_of',
      position: e.position,
      created_by: granted.userId,
    })),
  ]);
  if (edgeErr) {
    throw new Error(`seedLensViewDemo edges: ${edgeErr.message}`);
  }

  const { data: prj, error: prjErr } = await db
    .from('projections')
    .insert({
      space_id: spaceId,
      app_type: 'knowledge_base',
      name: 'Lens KB',
      view: 'lens',
      spec: buildLensSpec(kbTagNodeId),
      created_by: granted.userId,
      owner_user_id: granted.userId,
    })
    .select('id')
    .single();
  if (prjErr || !prj?.id) {
    throw new Error(
      `seedLensViewDemo projection: ${prjErr?.message ?? 'no id'}`
    );
  }

  return {
    hubAId,
    hubATitle,
    hubBId,
    hubBTitle,
    hubCId,
    hubCTitle,
    leafDId,
    leafDTitle,
    linkEId,
    linkETitle,
    kbTagNodeId,
    topicTagNodeId,
    lensProjectionId: prj.id,
  };
}

// ── slice-09 rev. 3: all-roles member actors (member1 / member2) ──────────────
//
// The product is now a SINGLE knowledge-base editor and every space member can
// author the graph by default (ADR-0011 §6 / ADR-0012): the base `member` role
// carries the full knowledge verb-set (read/create/update/delete/transition) via
// the member-grant migration. The rev. 3 acceptance test therefore no longer
// models a read/write role split (the deleted `reader`); instead it asserts that
// ANY ordinary member authors. These helpers mint plain `member`-role actors in
// the tenant's space.
//
// The negative case stays valid: `ungranted` (the base tenant's second actor —
// NOT carrying any knowledge verb) gets an empty rail/canvas and a clean RLS
// failure on write, proving the authority is RLS and the grant is membership.

export type KnowledgeMemberActor = {
  /** An ordinary space member (base `member` role → full knowledge verbs). */
  member: KnowledgeActor;
  /**
   * Back-compat alias of `member` for the not-yet-rewritten lens-view e2e (it
   * still reads `.reader`). Semantics changed: this actor now has the FULL verb
   * set, not read-only. Drop when the render-implementer rewrites that spec.
   */
  reader: KnowledgeActor;
  /** Extra user ids to cascade-clean on teardown. */
  extraUserIds: string[];
};

export type KnowledgeMemberActors = {
  /** First ordinary member — authors the graph (member role → full verbs). */
  member1: KnowledgeActor;
  /** Second ordinary member — ALSO authors (proves all-roles, not role split). */
  member2: KnowledgeActor;
  /** Extra user ids to cascade-clean on teardown. */
  extraUserIds: string[];
};

/**
 * Mint a single ordinary `member`-role actor in the tenant's space. The actor
 * receives the base `member` system role, so the all-roles grant gives it the
 * full knowledge verb-set with no special permission wiring.
 */
async function mintMemberActor(
  tenant: KnowledgeGraphTenant,
  label: string
): Promise<KnowledgeActor> {
  const { service, organizationId, spaceId } = tenant;
  const memberRoleId = await resolveMemberRoleId(service);

  const user = await createActor(service, label);

  const { error: omErr } = await service
    .from('organization_memberships')
    .insert({ organization_id: organizationId, user_id: user.id });
  if (omErr) throw new Error(`${label} org_membership: ${omErr.message}`);

  const { error: smErr } = await service
    .from('space_memberships')
    .insert({ space_id: spaceId, user_id: user.id, status: 'active' });
  if (smErr) throw new Error(`${label} space_membership: ${smErr.message}`);

  const { error: urErr } = await service
    .from('user_role')
    .insert({ user_id: user.id, space_id: spaceId, role_id: memberRoleId });
  if (urErr) throw new Error(`${label} user_role: ${urErr.message}`);

  const client = await authenticatedClient(user.email, user.password);

  return {
    userId: user.id,
    email: user.email,
    password: user.password,
    client,
  };
}

/**
 * Add two ordinary `member`-role actors (member1, member2) to an existing tenant.
 * Both author the graph through the all-roles grant — the rev. 3 replacement for
 * the deleted reader/granted role split.
 */
export async function bootstrapKnowledgeMemberActors(
  tenant: KnowledgeGraphTenant
): Promise<KnowledgeMemberActors> {
  const member1 = await mintMemberActor(tenant, 'member1');
  const member2 = await mintMemberActor(tenant, 'member2');
  return {
    member1,
    member2,
    extraUserIds: [member1.userId, member2.userId],
  };
}

/**
 * Reoriented from the deleted read-only `reader` helper to member semantics
 * (ADR-0011 §6 / ADR-0012, slice-09 rev. 3): the returned actor is now a plain
 * `member` carrying the FULL knowledge verb-set, not a read-only custom role —
 * role-distinction of writes is no longer modeled. Kept (not deleted) so the
 * not-yet-rewritten lens-view e2e keeps compiling; the render-implementer
 * rewrites that spec to use `bootstrapKnowledgeMemberActors` directly.
 */
export async function bootstrapLensReaderActor(
  tenant: KnowledgeGraphTenant
): Promise<KnowledgeMemberActor> {
  const member = await mintMemberActor(tenant, 'lens-member');
  return {
    member,
    reader: member,
    extraUserIds: [member.userId],
  };
}

// ── slice-11 Ф1: KB application-data satellites + folders/shortcut demo ───────
//
// The KB layer adds per-node ATTRIBUTES (satellites in the `kb` schema) and the
// folder/shortcut topology (folder nodes + `contains`/`shortcut` edges) over the
// SAME single graph. ZERO parallel topology: folders are nodes, containment and
// shortcuts are edges; descriptions/provenance/links/media-meta/embed-status are
// satellites keyed by node_id. Everything is seeded AS the granted actor (every
// write passes the RLS mirror — a satellite is writable IFF the node is), never
// migration-seeded (the identity-sync lesson). The kb table writes go through the
// user's RLS client over PostgREST against the exposed `kb` schema, proving the
// schema is reachable end-to-end under the access mirror.

export type KbApplicationGraph = {
  /** Root folder node (no incoming `contains`). */
  rootFolderId: string;
  rootFolderTitle: string;
  /** Child folder contained by the root (folder→folder containment). */
  childFolderId: string;
  childFolderTitle: string;
  /** A text doc contained by the child folder, carrying a description. */
  docId: string;
  docTitle: string;
  /** A file node contained by the child folder, carrying media-meta. */
  fileId: string;
  fileTitle: string;
  /** A link node contained by the root folder, carrying a resource_link. */
  linkId: string;
  linkTitle: string;
  /** A video node contained by the child folder, carrying media-meta. */
  videoId: string;
  videoTitle: string;
  /** `contains` edge ids (root→child, child→doc, child→file, root→link, child→video). */
  containsEdgeIds: string[];
  /** `shortcut` edge id (root folder → child folder cross-link, Drive symlink). */
  shortcutEdgeId: string;
};

/**
 * Seed the KB application-data demo over the existing tenant, AS the granted
 * actor. Builds:
 *  - a folder tree: root folder `contains` (child folder, link); child folder
 *    `contains` (doc, file, video) — forward `contains` edges only;
 *  - a `shortcut` edge root→child (cross-folder symlink, Drive-only render);
 *  - KB satellites under the RLS mirror: a description on the doc + root folder,
 *    provenance on the doc, a resource_link on the link node, media-meta on the
 *    file and video, an embed-status on the doc, and an activity counter on the doc.
 *
 * Every `kb.*` write uses the granted actor's RLS client (NOT service-role),
 * exercising the satellite RLS mirror over the PostgREST-exposed `kb` schema.
 */
export async function seedKbApplicationDemo(
  tenant: KnowledgeGraphTenant
): Promise<KbApplicationGraph> {
  const { granted, spaceId } = tenant;
  const db = granted.client;
  const kb = db.schema('kb');

  const rootFolderTitle = 'Getting Started';
  const childFolderTitle = 'Product Guides';
  const docTitle = 'Welcome Doc';
  const fileTitle = 'Onboarding.pdf';
  const linkTitle = 'Status Page';
  const videoTitle = 'Intro Video';

  const { data: nodes, error: nodesErr } = await db
    .from('knowledge_resources')
    .insert([
      {
        space_id: spaceId,
        kind: 'folder',
        title: rootFolderTitle,
        status: 'active',
        created_by: granted.userId,
        owner_user_id: granted.userId,
      },
      {
        space_id: spaceId,
        kind: 'folder',
        title: childFolderTitle,
        status: 'active',
        created_by: granted.userId,
        owner_user_id: granted.userId,
      },
      {
        space_id: spaceId,
        kind: 'text',
        title: docTitle,
        status: 'active',
        created_by: granted.userId,
        owner_user_id: granted.userId,
      },
      {
        space_id: spaceId,
        kind: 'file',
        title: fileTitle,
        status: 'active',
        created_by: granted.userId,
        owner_user_id: granted.userId,
      },
      {
        space_id: spaceId,
        kind: 'link',
        title: linkTitle,
        status: 'active',
        created_by: granted.userId,
        owner_user_id: granted.userId,
      },
      {
        space_id: spaceId,
        kind: 'video',
        title: videoTitle,
        status: 'active',
        created_by: granted.userId,
        owner_user_id: granted.userId,
      },
    ])
    .select('id,title');
  if (nodesErr || !nodes || nodes.length !== 6) {
    throw new Error(
      `seedKbApplicationDemo nodes: ${nodesErr?.message ?? 'count'}`
    );
  }
  const byTitle = new Map(nodes.map((n) => [n.title, n.id]));
  const rootFolderId = byTitle.get(rootFolderTitle);
  const childFolderId = byTitle.get(childFolderTitle);
  const docId = byTitle.get(docTitle);
  const fileId = byTitle.get(fileTitle);
  const linkId = byTitle.get(linkTitle);
  const videoId = byTitle.get(videoTitle);
  if (
    !rootFolderId ||
    !childFolderId ||
    !docId ||
    !fileId ||
    !linkId ||
    !videoId
  ) {
    throw new Error('seedKbApplicationDemo nodes: title ids missing');
  }

  // forward `contains` edges (folder → child) — breadcrumb/descendants walk these.
  const containsEdges = [
    { from: rootFolderId, to: childFolderId, position: 0 },
    { from: rootFolderId, to: linkId, position: 1 },
    { from: childFolderId, to: docId, position: 0 },
    { from: childFolderId, to: fileId, position: 1 },
    { from: childFolderId, to: videoId, position: 2 },
  ];
  const { data: contains, error: containsErr } = await db
    .from('knowledge_edges')
    .insert(
      containsEdges.map((e) => ({
        space_id: spaceId,
        from_id: e.from,
        to_id: e.to,
        relation_type: 'contains',
        position: e.position,
        created_by: granted.userId,
      }))
    )
    .select('id');
  if (containsErr || !contains || contains.length !== containsEdges.length) {
    throw new Error(
      `seedKbApplicationDemo contains: ${containsErr?.message ?? 'count'}`
    );
  }
  const containsEdgeIds = contains.map((e) => e.id);

  // `shortcut` edge (cross-folder symlink) — Drive-only, excluded from containment.
  const { data: shortcut, error: shortcutErr } = await db
    .from('knowledge_edges')
    .insert({
      space_id: spaceId,
      from_id: rootFolderId,
      to_id: childFolderId,
      relation_type: 'shortcut',
      position: 0,
      created_by: granted.userId,
    })
    .select('id')
    .single();
  if (shortcutErr || !shortcut?.id) {
    throw new Error(
      `seedKbApplicationDemo shortcut: ${shortcutErr?.message ?? 'no id'}`
    );
  }

  // ── KB satellites (every write passes the RLS mirror as the granted actor) ──
  const { error: descErr } = await kb.from('resource_description').insert([
    {
      node_id: docId,
      space_id: spaceId,
      body: 'Start here: the welcome doc indexed for retrieval.',
      created_by: granted.userId,
    },
    {
      node_id: rootFolderId,
      space_id: spaceId,
      body: 'Top-level folder for onboarding material.',
      created_by: granted.userId,
    },
  ]);
  if (descErr)
    throw new Error(`seedKbApplicationDemo description: ${descErr.message}`);

  const { error: provErr } = await kb
    .from('resource_provenance')
    .insert({ node_id: docId, space_id: spaceId, source: 'human' });
  if (provErr)
    throw new Error(`seedKbApplicationDemo provenance: ${provErr.message}`);

  const { error: actErr } = await kb
    .from('resource_activity')
    .insert({ node_id: docId, space_id: spaceId, view_count: 0 });
  if (actErr)
    throw new Error(`seedKbApplicationDemo activity: ${actErr.message}`);

  const { error: linkErr } = await kb.from('resource_link').insert({
    node_id: linkId,
    space_id: spaceId,
    url: 'https://status.acme.com',
    host: 'status.acme.com',
    created_by: granted.userId,
  });
  if (linkErr)
    throw new Error(`seedKbApplicationDemo link: ${linkErr.message}`);

  const { error: mediaErr } = await kb.from('resource_media_meta').insert([
    {
      node_id: fileId,
      space_id: spaceId,
      byte_size: 2_400_000,
      mime_type: 'application/pdf',
      created_by: granted.userId,
    },
    {
      node_id: videoId,
      space_id: spaceId,
      duration_ms: 760_000,
      mime_type: 'video/mp4',
      created_by: granted.userId,
    },
  ]);
  if (mediaErr)
    throw new Error(`seedKbApplicationDemo media_meta: ${mediaErr.message}`);

  const { error: embedErr } = await kb
    .from('resource_embedding')
    .insert({ node_id: docId, space_id: spaceId, status: 'stale' });
  if (embedErr)
    throw new Error(`seedKbApplicationDemo embedding: ${embedErr.message}`);

  return {
    rootFolderId,
    rootFolderTitle,
    childFolderId,
    childFolderTitle,
    docId,
    docTitle,
    fileId,
    fileTitle,
    linkId,
    linkTitle,
    videoId,
    videoTitle,
    containsEdgeIds,
    shortcutEdgeId: shortcut.id,
  };
}

/**
 * Cascade-delete the org (→ spaces → resources/edges/projections/memberships/
 * user_role) and both auth users + profiles. `extraUserIds` (slice-05 gating
 * actors added after bootstrap) are cleaned alongside the base actors.
 */
export async function teardownKnowledgeGraphTenant(
  tenant: KnowledgeGraphTenant,
  extraUserIds: string[] = []
): Promise<void> {
  const { service, organizationId, granted, ungranted } = tenant;

  await service.from('organizations').delete().eq('id', organizationId);

  for (const userId of [granted.userId, ungranted.userId, ...extraUserIds]) {
    await service.from('profiles').delete().eq('user_id', userId);
    await service.auth.admin.deleteUser(userId);
  }
}
