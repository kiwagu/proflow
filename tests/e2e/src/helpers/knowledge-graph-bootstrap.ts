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

/**
 * Cascade-delete the org (→ spaces → resources/edges/projections/memberships/
 * user_role) and both auth users + profiles.
 */
export async function teardownKnowledgeGraphTenant(
  tenant: KnowledgeGraphTenant
): Promise<void> {
  const { service, organizationId, granted, ungranted } = tenant;

  await service.from('organizations').delete().eq('id', organizationId);

  for (const actor of [granted, ungranted]) {
    await service.from('profiles').delete().eq('user_id', actor.userId);
    await service.auth.admin.deleteUser(actor.userId);
  }
}
