/**
 * Bootstrap environment for RBAC permission matrix E2E tests.
 *
 * Creates:
 *  - homeOrg  → homeSpace + foreignSpaceSameOrg  (same-org, different-space boundary)
 *  - foreignOrg → foreignOrgSpace                 (cross-org boundary)
 *
 * Provisions one authenticated Supabase client per test scenario, each carrying
 * the exact role(s) required by the matrix row it exercises. Clients use the
 * anon key — not the service role — so auth_user_has_permission executes with
 * real JWT scope.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@workspace/db';

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

export function hasLiveSupabaseConfig(): boolean {
  return Boolean(
    resolveSupabaseUrlOrNull() &&
    resolveServiceRoleKeyOrNull() &&
    resolveAnonKeyOrNull()
  );
}

// ── Public types ─────────────────────────────────────────────────────────────

export type RbacTestEnv = {
  service: SupabaseClient<Database>;
  homeOrgId: string;
  homeSpaceId: string;
  foreignSpaceSameOrgId: string;
  foreignOrgId: string;
  foreignOrgSpaceId: string;
  roleIdsByKey: Record<string, string>;
  userIdsByScenario: {
    member: string;
    space_admin: string;
    org_admin: string;
    student: string;
    tutor: string;
    manager: string;
    admin: string;
    author: string;
    union_member_space_admin: string;
    union_student_member: string;
    union_org_admin_student: string;
    no_roles: string;
  };
  /** Authenticated user clients keyed by scenario label */
  clients: {
    member: SupabaseClient<Database>;
    space_admin: SupabaseClient<Database>;
    org_admin: SupabaseClient<Database>;
    student: SupabaseClient<Database>;
    tutor: SupabaseClient<Database>;
    manager: SupabaseClient<Database>;
    admin: SupabaseClient<Database>;
    author: SupabaseClient<Database>;
    union_member_space_admin: SupabaseClient<Database>;
    union_student_member: SupabaseClient<Database>;
    union_org_admin_student: SupabaseClient<Database>;
    no_roles: SupabaseClient<Database>;
  };
  /** All auth user IDs — used for cascade cleanup */
  userIds: string[];
};

// ── Internal helpers ─────────────────────────────────────────────────────────

type TempUser = { id: string; email: string; password: string };

function serviceClient(): SupabaseClient<Database> {
  return createClient<Database>(
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
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function createUser(
  service: SupabaseClient<Database>,
  label: string
): Promise<TempUser> {
  const s = slug();
  const email = `e2e-rbac-${label}-${s}@example.test`;
  const password = `Pw!${s}Aa9`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`createUser(${label}): ${error?.message ?? 'no user'}`);
  }
  return { id: data.user.id, email, password };
}

async function signInClient(
  email: string,
  password: string
): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(
    resolveRequiredEnv('NEXT_PUBLIC_SUPABASE_URL', resolveSupabaseUrlOrNull()),
    resolveRequiredEnv('SUPABASE_ANON_KEY', resolveAnonKeyOrNull()),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`signInClient(${email}): ${error.message}`);
  }
  return client;
}

async function loadRoleIds(
  service: SupabaseClient<Database>,
  keys: string[]
): Promise<Map<string, string>> {
  const { data, error } = await service
    .from('roles')
    .select('id, key')
    .in('key', keys);
  if (error) throw new Error(`loadRoleIds: ${error.message}`);
  const map = new Map((data ?? []).map((r) => [r.key, r.id]));
  for (const key of keys) {
    if (!map.has(key)) throw new Error(`loadRoleIds: role '${key}' not found`);
  }
  return map;
}

async function createOrg(
  service: SupabaseClient<Database>,
  label: string
): Promise<string> {
  const s = slug();
  const { data, error } = await service
    .from('organizations')
    .insert({ name: `E2E RBAC ${label} ${s}`, slug: `rbac-${label}-${s}` })
    .select('id')
    .single();
  if (error || !data?.id)
    throw new Error(`createOrg(${label}): ${error?.message}`);
  return data.id;
}

async function createSpace(
  service: SupabaseClient<Database>,
  organizationId: string,
  label: string
): Promise<string> {
  const s = slug();
  const { data, error } = await service
    .from('spaces')
    .insert({
      organization_id: organizationId,
      name: `Space ${label}`,
      slug: `spc-${label}-${s}`,
    })
    .select('id')
    .single();
  if (error || !data?.id)
    throw new Error(`createSpace(${label}): ${error?.message}`);
  return data.id;
}

async function addSpaceMembership(
  service: SupabaseClient<Database>,
  userId: string,
  spaceId: string
): Promise<void> {
  const { error } = await service
    .from('space_memberships')
    .insert({ space_id: spaceId, user_id: userId, status: 'active' });
  if (error) throw new Error(`addSpaceMembership: ${error.message}`);
}

async function addOrgMembership(
  service: SupabaseClient<Database>,
  userId: string,
  organizationId: string
): Promise<void> {
  const { error } = await service
    .from('organization_memberships')
    .insert({ organization_id: organizationId, user_id: userId });
  if (error) throw new Error(`addOrgMembership: ${error.message}`);
}

async function assignSpaceRole(
  service: SupabaseClient<Database>,
  userId: string,
  spaceId: string,
  roleId: string
): Promise<void> {
  const { error } = await service
    .from('user_role')
    .insert({ user_id: userId, space_id: spaceId, role_id: roleId });
  if (error) throw new Error(`assignSpaceRole: ${error.message}`);
}

async function assignOrgRole(
  service: SupabaseClient<Database>,
  userId: string,
  organizationId: string,
  roleId: string
): Promise<void> {
  const { error } = await service.from('user_role').insert({
    user_id: userId,
    organization_id: organizationId,
    role_id: roleId,
  });
  if (error) throw new Error(`assignOrgRole: ${error.message}`);
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function bootstrapRbacPermissions(): Promise<RbacTestEnv> {
  const service = serviceClient();

  // Load role IDs for all roles used in the matrix
  const roleIds = await loadRoleIds(service, [
    'member',
    'space_admin',
    'org_admin',
    'student',
    'tutor',
    'manager',
    'admin',
    'author',
  ]);

  // Create org/space structure
  const homeOrgId = await createOrg(service, 'home');
  const homeSpaceId = await createSpace(service, homeOrgId, 'home');
  const foreignSpaceSameOrgId = await createSpace(
    service,
    homeOrgId,
    'foreign-same-org'
  );
  const foreignOrgId = await createOrg(service, 'foreign');
  const foreignOrgSpaceId = await createSpace(
    service,
    foreignOrgId,
    'foreign-org'
  );

  // Create all test users
  const userMap = await Promise.all([
    createUser(service, 'member'),
    createUser(service, 'space-admin'),
    createUser(service, 'org-admin'),
    createUser(service, 'student'),
    createUser(service, 'tutor'),
    createUser(service, 'manager'),
    createUser(service, 'admin'),
    createUser(service, 'author'),
    createUser(service, 'union-mem-sa'),
    createUser(service, 'union-stu-mem'),
    createUser(service, 'union-oa-stu'),
    createUser(service, 'no-roles'),
  ]);

  const [
    memberU,
    spaceAdminU,
    orgAdminU,
    studentU,
    tutorU,
    managerU,
    adminU,
    authorU,
    unionMemSaU,
    unionStuMemU,
    unionOaStudentU,
    noRolesU,
  ] = userMap;

  const userIds = userMap.map((u) => u.id);

  // ── Member ────────────────────────────────────────────────────────────────
  await addSpaceMembership(service, memberU.id, homeSpaceId);
  await assignSpaceRole(
    service,
    memberU.id,
    homeSpaceId,
    roleIds.get('member')!
  );

  // ── Space admin ───────────────────────────────────────────────────────────
  await addSpaceMembership(service, spaceAdminU.id, homeSpaceId);
  await assignSpaceRole(
    service,
    spaceAdminU.id,
    homeSpaceId,
    roleIds.get('space_admin')!
  );

  // ── Org admin ─────────────────────────────────────────────────────────────
  // Org-scoped: organization_id set, space_id null in user_role
  await addOrgMembership(service, orgAdminU.id, homeOrgId);
  await assignOrgRole(
    service,
    orgAdminU.id,
    homeOrgId,
    roleIds.get('org_admin')!
  );

  // ── Domain read-only roles ────────────────────────────────────────────────
  for (const [user, key] of [
    [studentU, 'student'],
    [tutorU, 'tutor'],
    [managerU, 'manager'],
  ] as [TempUser, string][]) {
    await addSpaceMembership(service, user.id, homeSpaceId);
    await assignSpaceRole(service, user.id, homeSpaceId, roleIds.get(key)!);
  }

  // ── Content roles ─────────────────────────────────────────────────────────
  await addSpaceMembership(service, adminU.id, homeSpaceId);
  await assignSpaceRole(service, adminU.id, homeSpaceId, roleIds.get('admin')!);

  await addSpaceMembership(service, authorU.id, homeSpaceId);
  await assignSpaceRole(
    service,
    authorU.id,
    homeSpaceId,
    roleIds.get('author')!
  );

  // ── Union: member + space_admin ───────────────────────────────────────────
  await addSpaceMembership(service, unionMemSaU.id, homeSpaceId);
  await assignSpaceRole(
    service,
    unionMemSaU.id,
    homeSpaceId,
    roleIds.get('member')!
  );
  await assignSpaceRole(
    service,
    unionMemSaU.id,
    homeSpaceId,
    roleIds.get('space_admin')!
  );

  // ── Union: student + member ───────────────────────────────────────────────
  await addSpaceMembership(service, unionStuMemU.id, homeSpaceId);
  await assignSpaceRole(
    service,
    unionStuMemU.id,
    homeSpaceId,
    roleIds.get('student')!
  );
  await assignSpaceRole(
    service,
    unionStuMemU.id,
    homeSpaceId,
    roleIds.get('member')!
  );

  // ── Union: org_admin + student ────────────────────────────────────────────
  await addOrgMembership(service, unionOaStudentU.id, homeOrgId);
  await assignOrgRole(
    service,
    unionOaStudentU.id,
    homeOrgId,
    roleIds.get('org_admin')!
  );
  await addSpaceMembership(service, unionOaStudentU.id, homeSpaceId);
  await assignSpaceRole(
    service,
    unionOaStudentU.id,
    homeSpaceId,
    roleIds.get('student')!
  );

  // ── No roles ──────────────────────────────────────────────────────────────
  await addSpaceMembership(service, noRolesU.id, homeSpaceId);
  // intentionally no user_role rows

  // Authenticate all users (parallel)
  const [
    memberClient,
    spaceAdminClient,
    orgAdminClient,
    studentClient,
    tutorClient,
    managerClient,
    adminClient,
    authorClient,
    unionMemSaClient,
    unionStuMemClient,
    unionOaStudentClient,
    noRolesClient,
  ] = await Promise.all([
    signInClient(memberU.email, memberU.password),
    signInClient(spaceAdminU.email, spaceAdminU.password),
    signInClient(orgAdminU.email, orgAdminU.password),
    signInClient(studentU.email, studentU.password),
    signInClient(tutorU.email, tutorU.password),
    signInClient(managerU.email, managerU.password),
    signInClient(adminU.email, adminU.password),
    signInClient(authorU.email, authorU.password),
    signInClient(unionMemSaU.email, unionMemSaU.password),
    signInClient(unionStuMemU.email, unionStuMemU.password),
    signInClient(unionOaStudentU.email, unionOaStudentU.password),
    signInClient(noRolesU.email, noRolesU.password),
  ]);

  return {
    service,
    homeOrgId,
    homeSpaceId,
    foreignSpaceSameOrgId,
    foreignOrgId,
    foreignOrgSpaceId,
    roleIdsByKey: Object.fromEntries(roleIds.entries()),
    userIdsByScenario: {
      member: memberU.id,
      space_admin: spaceAdminU.id,
      org_admin: orgAdminU.id,
      student: studentU.id,
      tutor: tutorU.id,
      manager: managerU.id,
      admin: adminU.id,
      author: authorU.id,
      union_member_space_admin: unionMemSaU.id,
      union_student_member: unionStuMemU.id,
      union_org_admin_student: unionOaStudentU.id,
      no_roles: noRolesU.id,
    },
    clients: {
      member: memberClient,
      space_admin: spaceAdminClient,
      org_admin: orgAdminClient,
      student: studentClient,
      tutor: tutorClient,
      manager: managerClient,
      admin: adminClient,
      author: authorClient,
      union_member_space_admin: unionMemSaClient,
      union_student_member: unionStuMemClient,
      union_org_admin_student: unionOaStudentClient,
      no_roles: noRolesClient,
    },
    userIds,
  };
}

export async function teardownRbacPermissions(env: RbacTestEnv): Promise<void> {
  const { service, homeOrgId, foreignOrgId, userIds } = env;

  // Cascade orgs → spaces → memberships → invites
  for (const orgId of [homeOrgId, foreignOrgId]) {
    await service.from('organizations').delete().eq('id', orgId);
  }

  // Delete auth users + profiles
  for (const userId of userIds) {
    await service.from('profiles').delete().eq('user_id', userId);
    await service.auth.admin.deleteUser(userId);
  }
}
