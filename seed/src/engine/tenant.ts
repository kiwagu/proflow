import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { KB_MEDIA_BUCKET } from '@workspace/knowledge-contracts';

import {
  authenticatedClient,
  createActor,
  ensureActor,
  resolveRoleIds,
  serviceSupabase,
  slug,
} from './actors.js';
import type { SeedActor, SeedTenant } from './types.js';

// ── Stable demo identity (the persistent `--demo` fixtures) ──────────────────
export const DEMO_ORG_SLUG = 'proflow-demo';
export const DEMO_SPACE_SLUG = 'demo-space';
const DEMO_ORG_NAME = 'ProFlow Demo';
const DEMO_SPACE_NAME = 'Demo Space';
const DEMO_PASSWORD = 'ProflowDemo!1';
export const DEMO_ADMIN_EMAIL = 'demo-admin@proflow.local';
export const DEMO_VIEWER_EMAIL = 'demo-viewer@proflow.local';

/** Treat a Postgres unique-violation as a no-op (idempotent ensure). */
function isDuplicate(error: PostgrestError | null): boolean {
  return error?.code === '23505';
}

async function insertIgnoreDuplicate(
  service: SupabaseClient,
  table: string,
  row: Record<string, unknown>
): Promise<void> {
  const { error } = await service.from(table).insert(row);
  if (error && !isDuplicate(error)) {
    throw new Error(`ensure ${table}: ${error.message}`);
  }
}

// ── Ephemeral tenant (the e2e default — random identity + teardown) ──────────

/**
 * Create an org + space + two actors through the SAME runtime path the product
 * uses (service-role inserts into organizations/spaces/memberships + an RBAC
 * `user_role` grant). `granted` → the `admin` space role (all `space.knowledge.*`
 * verbs); `ungranted` → `space_admin` only (no knowledge verbs); `member` → the
 * `member` role (read + create — authors its OWN content) which backs the catalog
 * `viewer` ref. All three are active space members. Random identity; pair with
 * `teardownTenant`.
 */
export async function bootstrapEphemeralTenant(): Promise<SeedTenant> {
  const service = serviceSupabase();
  const s = slug();

  const grantedUser = await createActor(service, 'granted');
  const ungrantedUser = await createActor(service, 'ungranted');

  const { data: org, error: orgErr } = await service
    .from('organizations')
    .insert({ name: `Seed Org ${s}`, slug: s })
    .select('id')
    .single();
  if (orgErr || !org?.id) {
    throw new Error(`bootstrap org: ${orgErr?.message ?? 'no id'}`);
  }

  const { data: space, error: spErr } = await service
    .from('spaces')
    .insert({ organization_id: org.id, name: 'Seed Space', slug: `spc-${s}` })
    .select('id')
    .single();
  if (spErr || !space?.id) {
    throw new Error(`bootstrap space: ${spErr?.message ?? 'no id'}`);
  }

  await service.from('organization_memberships').insert([
    { organization_id: org.id, user_id: grantedUser.id },
    { organization_id: org.id, user_id: ungrantedUser.id },
  ]);
  await service.from('space_memberships').insert([
    { space_id: space.id, user_id: grantedUser.id, status: 'active' },
    { space_id: space.id, user_id: ungrantedUser.id, status: 'active' },
  ]);

  const { adminRoleId, spaceAdminRoleId } = await resolveRoleIds(service);
  const { error: urErr } = await service.from('user_role').insert([
    { user_id: grantedUser.id, space_id: space.id, role_id: adminRoleId },
    {
      user_id: ungrantedUser.id,
      space_id: space.id,
      role_id: spaceAdminRoleId,
    },
  ]);
  if (urErr) throw new Error(`bootstrap user_role: ${urErr.message}`);

  const tenant: SeedTenant = {
    organizationId: org.id,
    spaceId: space.id,
    granted: await actorWithClient(grantedUser),
    ungranted: await actorWithClient(ungrantedUser),
    // Placeholder; replaced below by a real `member`-role actor. (`member` is the
    // catalog `viewer` ref's backing actor — minted through the same RBAC path as
    // every other member, active in this org+space.)
    member: undefined as unknown as SeedActor,
    service,
  };
  // A read+create `member` actor backing the catalog `viewer` ref. Distinct from the
  // verb-less `ungranted` negative actor: this one CAN author its own content, so a
  // scenario's `owner: 'viewer'` node materializes in the ephemeral tenant exactly as
  // it does in the demo tenant (where the demo-viewer is already a member).
  tenant.member = await bootstrapMemberActor(tenant);
  return tenant;
}

async function actorWithClient(u: {
  id: string;
  email: string;
  password: string;
}): Promise<SeedActor> {
  return {
    userId: u.id,
    email: u.email,
    password: u.password,
    client: await authenticatedClient(u.email, u.password),
  };
}

/**
 * Add a `member`-role actor to an existing tenant (every space member can author
 * their OWN content: read + create only). Created through the real RBAC path
 * (service-role membership + `user_role`).
 */
export async function bootstrapMemberActor(
  tenant: SeedTenant
): Promise<SeedActor> {
  const { service, organizationId, spaceId } = tenant;
  const { data: roleRow, error: roleErr } = await service
    .from('roles')
    .select('id')
    .eq('role_kind', 'system')
    .eq('key', 'member')
    .maybeSingle();
  if (roleErr || !roleRow?.id) {
    throw new Error(
      `bootstrapMemberActor: member role not found — ${roleErr?.message ?? 'missing'}`
    );
  }
  const u = await createActor(service, 'member');
  await service
    .from('organization_memberships')
    .insert({ organization_id: organizationId, user_id: u.id });
  await service
    .from('space_memberships')
    .insert({ space_id: spaceId, user_id: u.id, status: 'active' });
  const { error: urErr } = await service
    .from('user_role')
    .insert({ user_id: u.id, space_id: spaceId, role_id: roleRow.id });
  if (urErr) throw new Error(`bootstrapMemberActor role: ${urErr.message}`);
  return actorWithClient(u);
}

async function roleIdByKey(
  service: SupabaseClient,
  key: string
): Promise<string> {
  const { data, error } = await service
    .from('roles')
    .select('id')
    .eq('role_kind', 'system')
    .eq('key', key)
    .maybeSingle();
  if (error || !data?.id) {
    throw new Error(`roleIdByKey(${key}): ${error?.message ?? 'not found'}`);
  }
  return data.id;
}

/**
 * Add a participant to a tenant with a given system role. `stable: true` (the demo
 * tenant) ensures a deterministic, idempotent user; otherwise a random ephemeral
 * one. Memberships + the role grant go through the real RBAC path and are
 * idempotent, so a demo re-run reuses the same actor.
 */
export async function addActor(
  tenant: SeedTenant,
  opts: { label: string; roleKey: string; stable: boolean }
): Promise<SeedActor> {
  const { service, organizationId, spaceId } = tenant;
  const roleId = await roleIdByKey(service, opts.roleKey);
  const user = opts.stable
    ? await ensureActor(
        service,
        `seed-${opts.label}@proflow.local`,
        DEMO_PASSWORD
      )
    : await createActor(service, opts.label);

  await insertIgnoreDuplicate(service, 'organization_memberships', {
    organization_id: organizationId,
    user_id: user.id,
  });
  await insertIgnoreDuplicate(service, 'space_memberships', {
    space_id: spaceId,
    user_id: user.id,
    status: 'active',
  });
  await insertIgnoreDuplicate(service, 'user_role', {
    user_id: user.id,
    space_id: spaceId,
    role_id: roleId,
  });
  return actorWithClient(user);
}

/**
 * Destroy an ephemeral tenant completely: the space's content first, then the
 * space, the organization, and every participant's profile + auth user.
 *
 * Order is not cosmetic. Deleting the organization alone cascades into spaces
 * and on into `knowledge_resources`, whose BEFORE-DELETE audit trigger writes a
 * tombstone referencing the space — which by then is already gone, so the audit
 * insert violates its foreign key and the whole delete fails. Removing the
 * content while its space still exists keeps every tombstone resolvable.
 *
 * The participant set is READ FROM THE TENANT, not from the caller: a scenario
 * mints its own actors as it runs, and a caller-supplied list would silently
 * miss exactly those. `extraUserIds` remains for participants that never became
 * members.
 *
 * Every delete is error-checked. Unchecked errors are what let this stay broken
 * silently: the tenant looked torn down while orgs, spaces and resources
 * accumulated in the database run after run.
 *
 * Ephemeral tenants only — never call on the demo tenant.
 */
export async function teardownTenant(
  tenant: SeedTenant,
  extraUserIds: string[] = []
): Promise<void> {
  const { service, organizationId, spaceId, granted, ungranted, member } =
    tenant;

  // Read the membership BEFORE the organization goes: the memberships cascade
  // away with it, and with them any record of who took part.
  const { data: members, error: membersErr } = await service
    .from('organization_memberships')
    .select('user_id')
    .eq('organization_id', organizationId);
  if (membersErr) {
    throw new Error(`teardownTenant members: ${membersErr.message}`);
  }

  await resetSpaceContent(service, spaceId);

  const { error: spaceErr } = await service
    .from('spaces')
    .delete()
    .eq('organization_id', organizationId);
  if (spaceErr) {
    throw new Error(`teardownTenant spaces: ${spaceErr.message}`);
  }

  const { error: orgErr } = await service
    .from('organizations')
    .delete()
    .eq('id', organizationId);
  if (orgErr) {
    throw new Error(`teardownTenant organization: ${orgErr.message}`);
  }

  const userIds = new Set<string>([
    granted.userId,
    ungranted.userId,
    // `member` may be absent on a hand-built tenant; guard the field.
    ...(member ? [member.userId] : []),
    ...(members ?? []).map((row) => (row as { user_id: string }).user_id),
    ...extraUserIds,
  ]);
  for (const userId of userIds) {
    const { error: profileErr } = await service
      .from('profiles')
      .delete()
      .eq('user_id', userId);
    if (profileErr) {
      throw new Error(
        `teardownTenant profile ${userId}: ${profileErr.message}`
      );
    }
    const { error: userErr } = await service.auth.admin.deleteUser(userId);
    if (userErr) {
      throw new Error(`teardownTenant user ${userId}: ${userErr.message}`);
    }
  }
}

/**
 * Wipe all knowledge content from a space (service-role) so a re-seed lands a
 * deterministic state — the demo tenant's shell (org/space/users) is preserved,
 * but its content is rebuilt from scratch. Never call on a shared/production space.
 *
 * Ordering matters: `knowledge_edges` is deleted BEFORE `knowledge_resources`.
 * The `assert_purge_not_in_use` BEFORE-DELETE guard treats a row as "in use" when
 * it has a LIVING edge to a node owned by a DIFFERENT user — and under service-role
 * `auth.uid()` is NULL, so `owner_user_id IS DISTINCT FROM auth.uid()` is true for
 * EVERY edge, making the guard raise on any still-connected resource. Removing the
 * edges first leaves the resources edge-free, so the guard passes. Each delete is
 * error-checked — a swallowed failure here silently accumulates demo content.
 */
export async function resetSpaceContent(
  service: SupabaseClient,
  spaceId: string
): Promise<void> {
  const del = async (table: string): Promise<void> => {
    const { error } = await service
      .from(table)
      .delete()
      .eq('space_id', spaceId);
    if (error) throw new Error(`resetSpaceContent ${table}: ${error.message}`);
  };
  await del('projections');
  // Edges first: clears the cross-owner "in-use" guard for service-role deletes.
  await del('knowledge_edges');
  // Now edge-free → the purge guard passes; cascades scope links / activity / satellites.
  await del('knowledge_resources');
  // Document bodies and blob records are keyed by space. In teardown the space
  // itself goes and cascades them, but `--reset` keeps the space and rebuilds its
  // content — without this a demo re-seed would leave every previous body behind,
  // unreachable and counted.
  await del('crdt_documents');
  // The uploaded bytes, though, outlive every row that points at them — an object
  // in a bucket has no foreign key to cascade, so a teardown that only drops rows
  // leaves the bytes on disk (measured: nine orphaned objects per run). Remove them
  // while the blob records still name their paths, then drop the records.
  await reapSpaceMedia(service, spaceId);
  await del('scopes'); // cascades scope_memberships
  await del('reporting_lines');
}

/**
 * Delete a space's uploaded media: the bucket objects first (addressed by the
 * blob records), then the records. Storage failures are fatal here — this is the
 * cleanup path whose whole purpose is leaving nothing behind, so a silent failure
 * would defeat it.
 */
async function reapSpaceMedia(
  service: SupabaseClient,
  spaceId: string
): Promise<void> {
  const kb = service.schema('kb');
  const { data: blobs, error } = await kb
    .from('media_blob')
    .select('storage_bucket, storage_path')
    .eq('space_id', spaceId);
  if (error) throw new Error(`resetSpaceContent media_blob: ${error.message}`);

  const byBucket = new Map<string, string[]>();
  for (const row of (blobs ?? []) as {
    storage_bucket: string | null;
    storage_path: string;
  }[]) {
    const bucket = row.storage_bucket ?? KB_MEDIA_BUCKET;
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), row.storage_path]);
  }
  for (const [bucket, paths] of byBucket) {
    const { error: removeErr } = await service.storage
      .from(bucket)
      .remove(paths);
    if (removeErr) {
      throw new Error(
        `resetSpaceContent storage ${bucket}: ${removeErr.message}`
      );
    }
  }

  const { error: blobErr } = await kb
    .from('media_blob')
    .delete()
    .eq('space_id', spaceId);
  if (blobErr) {
    throw new Error(`resetSpaceContent media_blob delete: ${blobErr.message}`);
  }
}

// ── Demo tenant (the persistent `--demo` fixtures — idempotent) ──────────────

/** Idempotently make `userId` an org+space member carrying `roleId`. */
async function ensureMember(
  service: SupabaseClient,
  organizationId: string,
  spaceId: string,
  userId: string,
  roleId: string
): Promise<void> {
  await insertIgnoreDuplicate(service, 'organization_memberships', {
    organization_id: organizationId,
    user_id: userId,
  });
  await insertIgnoreDuplicate(service, 'space_memberships', {
    space_id: spaceId,
    user_id: userId,
    status: 'active',
  });
  await insertIgnoreDuplicate(service, 'user_role', {
    user_id: userId,
    space_id: spaceId,
    role_id: roleId,
  });
}

/**
 * Idempotently provision the STABLE demo tenant: an org + space addressed by a
 * fixed slug, with two `demo-*` users. `demo-admin` is the `admin` (primary content
 * owner); `demo-viewer` is a `member` (read + create) — NOT `space_admin` — so it can
 * author its OWN content and SEE what `demo-admin` shares with it. Both authoring is
 * needed for the cross-shared "Shared with me" demo. Safe to re-run.
 */
export async function provisionDemoTenant(): Promise<SeedTenant> {
  const service = serviceSupabase();

  const organizationId = await ensureOrganization(service);
  const spaceId = await ensureSpace(service, organizationId);
  const { adminRoleId } = await resolveRoleIds(service);
  const memberRoleId = await roleIdByKey(service, 'member');

  const adminUser = await ensureActor(service, DEMO_ADMIN_EMAIL, DEMO_PASSWORD);
  await ensureMember(
    service,
    organizationId,
    spaceId,
    adminUser.id,
    adminRoleId
  );

  const viewerUser = await ensureActor(
    service,
    DEMO_VIEWER_EMAIL,
    DEMO_PASSWORD
  );
  await ensureMember(
    service,
    organizationId,
    spaceId,
    viewerUser.id,
    memberRoleId
  );

  // In the demo tenant the demo-viewer is ALREADY a `member` (read + create), so it
  // backs BOTH the `ungranted` field (the demo has no separate verb-less actor — the
  // demo seed never asserts the negative case) AND the catalog `viewer` ref (`member`).
  // The materializer resolves the `viewer` ref to `tenant.member`, so a `owner: 'viewer'`
  // node authors as the demo-viewer in both modes.
  const viewerActor = await actorWithClient(viewerUser);
  return {
    organizationId,
    spaceId,
    granted: await actorWithClient(adminUser),
    ungranted: viewerActor,
    member: viewerActor,
    service,
  };
}

async function ensureOrganization(service: SupabaseClient): Promise<string> {
  const { data: existing } = await service
    .from('organizations')
    .select('id')
    .eq('slug', DEMO_ORG_SLUG)
    .maybeSingle();
  if (existing?.id) return existing.id;
  const { data, error } = await service
    .from('organizations')
    .insert({ name: DEMO_ORG_NAME, slug: DEMO_ORG_SLUG })
    .select('id')
    .single();
  if (error || !data?.id) {
    throw new Error(`ensureOrganization: ${error?.message ?? 'no id'}`);
  }
  return data.id;
}

async function ensureSpace(
  service: SupabaseClient,
  organizationId: string
): Promise<string> {
  const { data: existing } = await service
    .from('spaces')
    .select('id')
    .eq('slug', DEMO_SPACE_SLUG)
    .maybeSingle();
  if (existing?.id) return existing.id;
  const { data, error } = await service
    .from('spaces')
    .insert({
      organization_id: organizationId,
      name: DEMO_SPACE_NAME,
      slug: DEMO_SPACE_SLUG,
    })
    .select('id')
    .single();
  if (error || !data?.id) {
    throw new Error(`ensureSpace: ${error?.message ?? 'no id'}`);
  }
  return data.id;
}
