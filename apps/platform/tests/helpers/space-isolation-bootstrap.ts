/**
 * Bootstrap two fully isolated tenants (org + space + user) for cross-space
 * isolation E2E tests. Each user gets their own org, space, and admin
 * membership. Returns authenticated Supabase clients scoped to each user's
 * JWT so RLS tests exercise real row-level security.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const repoRoot = resolve(import.meta.dirname, '../../../..');
const localSupabaseEnv = readEnvFileIfPresent(
  resolve(repoRoot, 'infra/dev/supabase/.env')
);

function readEnvFileIfPresent(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) {
    return {};
  }

  const entries: Record<string, string> = {};
  const contents = readFileSync(filePath, 'utf8');

  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    entries[key] = value;
  }

  return entries;
}

function resolveSupabaseUrlOrNull(): string | null {
  return (
    process.env.E2E_SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    localSupabaseEnv.API_EXTERNAL_URL ||
    localSupabaseEnv.SUPABASE_PUBLIC_URL ||
    null
  );
}

function resolveServiceRoleKeyOrNull(): string | null {
  return (
    process.env.E2E_SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    localSupabaseEnv.SERVICE_ROLE_KEY ||
    null
  );
}

function resolveAnonKeyOrNull(): string | null {
  return (
    process.env.E2E_SUPABASE_ANON_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    localSupabaseEnv.ANON_KEY ||
    null
  );
}

function resolveRequiredEnv(name: string, value: string | null): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function createAnonClient(): SupabaseClient {
  return createClient(
    resolveRequiredEnv('NEXT_PUBLIC_SUPABASE_URL', resolveSupabaseUrlOrNull()),
    resolveRequiredEnv('SUPABASE_ANON_KEY', resolveAnonKeyOrNull()),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );
}

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
  return createClient(
    resolveRequiredEnv('NEXT_PUBLIC_SUPABASE_URL', resolveSupabaseUrlOrNull()),
    resolveRequiredEnv(
      'SUPABASE_SERVICE_ROLE_KEY',
      resolveServiceRoleKeyOrNull()
    ),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );
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
  const client = createAnonClient();
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
