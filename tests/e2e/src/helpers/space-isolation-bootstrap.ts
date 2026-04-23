/**
 * Bootstrap two fully isolated tenants (org + space + user) for cross-space
 * isolation E2E tests. Each user gets their own org, space, and admin
 * membership. Returns authenticated Supabase clients scoped to each user's
 * JWT so RLS tests exercise real row-level security.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  resolveAnonKey,
  resolveServiceRoleKey,
  resolveSupabaseUrl,
} from './test-user.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type IsolatedTenant = {
  userId: string;
  email: string;
  password: string;
  organizationId: string;
  spaceId: string;
  /** Authenticated client (user JWT) — subject to RLS. */
  client: SupabaseClient;
};

export type TwoTenantIsolation = {
  tenantA: IsolatedTenant;
  tenantB: IsolatedTenant;
  /** Service-role client — bypasses RLS (for setup/assertions). */
  service: SupabaseClient;
};

// ── Internal helpers ─────────────────────────────────────────────────────────

function serviceSupabase(): SupabaseClient {
  return createClient(resolveSupabaseUrl(), resolveServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function slug(): string {
  return `iso-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createTestUser(
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
    throw new Error(`createTestUser(${label}): ${error?.message ?? 'no user'}`);
  }
  return { id: data.user.id, email, password };
}

/**
 * Returns a Supabase client authenticated with the user's JWT (via anon key).
 * Using anon key — not service role — so the client is fully subject to RLS.
 */
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

async function bootstrapTenant(
  service: SupabaseClient,
  userId: string,
  email: string,
  password: string,
  label: string
): Promise<IsolatedTenant> {
  const s = slug();
  const { data: roleRows, error: roleErr } = await service
    .from('roles')
    .select('id,key')
    .in('key', ['org_admin', 'space_admin']);
  if (roleErr) {
    throw new Error(`bootstrapTenant roles: ${roleErr.message}`);
  }
  const roleByKey = new Map((roleRows ?? []).map((r) => [r.key, r.id]));
  const orgAdminRoleId = roleByKey.get('org_admin');
  const spaceAdminRoleId = roleByKey.get('space_admin');
  if (!orgAdminRoleId || !spaceAdminRoleId) {
    throw new Error('bootstrapTenant roles: org_admin/space_admin not found');
  }

  // Organization
  const { data: org, error: orgErr } = await service
    .from('organizations')
    .insert({ name: `E2E Iso ${label} ${s}`, slug: `${label}-${s}` })
    .select('id')
    .single();
  if (orgErr || !org?.id) {
    throw new Error(`bootstrapTenant org: ${orgErr?.message}`);
  }

  // org_admin membership
  const { error: omErr } = await service
    .from('organization_memberships')
    .insert({ organization_id: org.id, user_id: userId });
  if (omErr)
    throw new Error(`bootstrapTenant org_membership: ${omErr.message}`);

  // Space
  const spaceSlug = `spc-${label}-${s}`;
  const { data: space, error: spErr } = await service
    .from('spaces')
    .insert({
      organization_id: org.id,
      name: `Space ${label}`,
      slug: spaceSlug,
    })
    .select('id')
    .single();
  if (spErr || !space?.id) {
    throw new Error(`bootstrapTenant space: ${spErr?.message}`);
  }

  // space admin membership
  const { error: smErr } = await service.from('space_memberships').insert({
    space_id: space.id,
    user_id: userId,
    status: 'active',
  });
  if (smErr)
    throw new Error(`bootstrapTenant space_membership: ${smErr.message}`);

  const { error: urErr } = await service.from('user_role').insert([
    {
      user_id: userId,
      organization_id: org.id,
      role_id: orgAdminRoleId,
    },
    {
      user_id: userId,
      space_id: space.id,
      role_id: spaceAdminRoleId,
    },
  ]);
  if (urErr) {
    throw new Error(`bootstrapTenant user_role: ${urErr.message}`);
  }

  const client = await authenticatedClient(email, password);

  return {
    userId,
    email,
    password,
    organizationId: org.id,
    spaceId: space.id,
    client,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Creates two users, two orgs, two spaces — fully isolated from each other.
 * Returns authenticated Supabase clients for each user plus a service client.
 */
export async function bootstrapTwoTenants(): Promise<TwoTenantIsolation> {
  const service = serviceSupabase();

  const userA = await createTestUser(service, 'iso-a');
  const userB = await createTestUser(service, 'iso-b');

  const tenantA = await bootstrapTenant(
    service,
    userA.id,
    userA.email,
    userA.password,
    'a'
  );
  const tenantB = await bootstrapTenant(
    service,
    userB.id,
    userB.email,
    userB.password,
    'b'
  );

  return { tenantA, tenantB, service };
}

/**
 * Cascade-delete both orgs (which cascades spaces, memberships, invites)
 * and then delete both auth users.
 */
export async function teardownTwoTenants(
  env: TwoTenantIsolation
): Promise<void> {
  const { tenantA, tenantB, service } = env;

  // Delete invites first to keep isolation fixtures deterministic.
  for (const t of [tenantA, tenantB]) {
    await service
      .from('space_invites')
      .delete()
      .eq('created_by_user_id', t.userId);
  }

  // Cascade orgs → spaces → space_memberships.
  for (const t of [tenantA, tenantB]) {
    await service.from('organizations').delete().eq('id', t.organizationId);
  }

  // Profiles + auth users.
  for (const t of [tenantA, tenantB]) {
    await service.from('profiles').delete().eq('user_id', t.userId);
    await service.auth.admin.deleteUser(t.userId);
  }
}
