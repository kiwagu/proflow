import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Database, Json } from '@workspace/db';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

type SeededUser = {
  id: string;
  email: string;
  password: string;
};

type TestBootstrap = {
  organizationId: string;
  spaceId: string;
};

type AuditRow = {
  action: string;
  organization_id: string | null;
  space_id: string | null;
  new_value: Json | null;
  previous_value: Json | null;
};

const repoRoot = resolve(import.meta.dirname, '../../..');
const localSupabaseEnv = readEnvFileIfPresent(
  resolve(repoRoot, 'infra/dev/supabase/.env')
);

const liveSupabaseConfigured = Boolean(
  resolveSupabaseUrlOrNull() &&
  resolveServiceRoleKeyOrNull() &&
  resolveAnonKeyOrNull()
);

const describeLive = liveSupabaseConfigured ? describe : describe.skip;

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

function resolveRequiredEnv(name: string, value: string | null): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function serviceSupabase() {
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

function anonSupabase() {
  return createClient<Database>(
    resolveRequiredEnv('NEXT_PUBLIC_SUPABASE_URL', resolveSupabaseUrlOrNull()),
    resolveRequiredEnv('SUPABASE_ANON_KEY', resolveAnonKeyOrNull()),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );
}

function randomToken(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function seedTestUser(prefix: string): Promise<SeededUser> {
  const supabase = serviceSupabase();
  const suffix = randomToken();
  const email = `${prefix}-${suffix}@example.test`;
  const password = `Pw!${suffix}Aa9`;

  const createResult = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createResult.error || !createResult.data.user) {
    throw new Error(
      `seedTestUser: ${createResult.error?.message ?? 'missing auth user response'}`
    );
  }

  return {
    id: createResult.data.user.id,
    email,
    password,
  };
}

async function cleanupTestUser(userId: string): Promise<void> {
  const supabase = serviceSupabase();

  await supabase
    .from('space_invites')
    .delete()
    .eq('created_by_user_id', userId);
  await supabase.from('profiles').delete().eq('user_id', userId);

  const deleteUser = await supabase.auth.admin.deleteUser(userId);
  if (
    deleteUser.error &&
    !deleteUser.error.message.toLowerCase().includes('user not found')
  ) {
    throw new Error(`cleanupTestUser: ${deleteUser.error.message}`);
  }
}

async function requireSystemRoleIds() {
  const supabase = serviceSupabase();
  const { data, error } = await supabase
    .from('roles')
    .select('id,key')
    .in('key', ['org_admin', 'space_admin'])
    .eq('role_kind', 'system')
    .is('owner_organization_id', null)
    .is('archived_at', null);

  if (error) {
    throw new Error(`requireSystemRoleIds: ${error.message}`);
  }

  const roleByKey = new Map((data ?? []).map((row) => [row.key, row.id]));
  const orgAdminRoleId = roleByKey.get('org_admin');
  const spaceAdminRoleId = roleByKey.get('space_admin');

  if (!orgAdminRoleId || !spaceAdminRoleId) {
    throw new Error(
      'requireSystemRoleIds: org_admin/space_admin roles missing'
    );
  }

  return { orgAdminRoleId, spaceAdminRoleId };
}

async function bootstrapRuntimeSettingsBoundaryFixture(input: {
  orgAdminUserId: string;
  spaceAdminUserId: string;
}): Promise<TestBootstrap> {
  const supabase = serviceSupabase();
  const { orgAdminRoleId, spaceAdminRoleId } = await requireSystemRoleIds();
  const slug = `rs-rpc-${randomToken()}`;

  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .insert({
      name: `Runtime Settings RPC ${slug}`,
      slug,
    })
    .select('id')
    .single();

  if (orgErr || !org?.id) {
    throw new Error(
      `bootstrapRuntimeSettingsBoundaryFixture org: ${orgErr?.message ?? 'missing id'}`
    );
  }

  const { data: space, error: spaceErr } = await supabase
    .from('spaces')
    .insert({
      organization_id: org.id,
      name: 'Runtime Settings RPC Space',
      slug: `spc-${slug}`,
    })
    .select('id')
    .single();

  if (spaceErr || !space?.id) {
    throw new Error(
      `bootstrapRuntimeSettingsBoundaryFixture space: ${spaceErr?.message ?? 'missing id'}`
    );
  }

  const { error: orgMembershipErr } = await supabase
    .from('organization_memberships')
    .insert([
      {
        organization_id: org.id,
        user_id: input.orgAdminUserId,
      },
      {
        organization_id: org.id,
        user_id: input.spaceAdminUserId,
      },
    ]);

  if (orgMembershipErr) {
    throw new Error(
      `bootstrapRuntimeSettingsBoundaryFixture org membership: ${orgMembershipErr.message}`
    );
  }

  const { error: spaceMembershipErr } = await supabase
    .from('space_memberships')
    .insert([
      {
        space_id: space.id,
        user_id: input.orgAdminUserId,
        status: 'active',
      },
      {
        space_id: space.id,
        user_id: input.spaceAdminUserId,
        status: 'active',
      },
    ]);

  if (spaceMembershipErr) {
    throw new Error(
      `bootstrapRuntimeSettingsBoundaryFixture space membership: ${spaceMembershipErr.message}`
    );
  }

  const { error: roleErr } = await supabase.from('user_role').insert([
    {
      user_id: input.orgAdminUserId,
      organization_id: org.id,
      role_id: orgAdminRoleId,
    },
    {
      user_id: input.spaceAdminUserId,
      space_id: space.id,
      role_id: spaceAdminRoleId,
    },
  ]);

  if (roleErr) {
    throw new Error(
      `bootstrapRuntimeSettingsBoundaryFixture roles: ${roleErr.message}`
    );
  }

  return {
    organizationId: org.id,
    spaceId: space.id,
  };
}

async function deleteOrganizationCascade(
  organizationId: string
): Promise<void> {
  const supabase = serviceSupabase();
  const { data: spaceRows, error: spaceErr } = await supabase
    .from('spaces')
    .select('id')
    .eq('organization_id', organizationId);

  if (spaceErr) {
    throw new Error(`deleteOrganizationCascade spaces: ${spaceErr.message}`);
  }

  const spaceIds = (spaceRows ?? []).map((space) => space.id);

  const { error: deleteOrgSettingsErr } = await supabase
    .from('runtime_settings')
    .delete()
    .eq('scope', 'organization')
    .eq('scope_id', organizationId);

  if (deleteOrgSettingsErr) {
    throw new Error(
      `deleteOrganizationCascade org settings: ${deleteOrgSettingsErr.message}`
    );
  }

  if (spaceIds.length > 0) {
    const { error: deleteSpaceSettingsErr } = await supabase
      .from('runtime_settings')
      .delete()
      .eq('scope', 'space')
      .in('scope_id', spaceIds);

    if (deleteSpaceSettingsErr) {
      throw new Error(
        `deleteOrganizationCascade space settings: ${deleteSpaceSettingsErr.message}`
      );
    }
  }

  const { error: deleteOrgErr } = await supabase
    .from('organizations')
    .delete()
    .eq('id', organizationId);

  if (deleteOrgErr) {
    throw new Error(`deleteOrganizationCascade org: ${deleteOrgErr.message}`);
  }
}

async function deleteRuntimeSettingsByKey(key: string): Promise<void> {
  const supabase = serviceSupabase();
  const { error } = await supabase
    .from('runtime_settings')
    .delete()
    .eq('key', key);

  if (error) {
    throw new Error(`deleteRuntimeSettingsByKey: ${error.message}`);
  }
}

async function grantPlatformSuperAdmin(userId: string): Promise<void> {
  const supabase = serviceSupabase();
  const { error } = await supabase.rpc(
    'rpc_service_role_grant_platform_super_admin',
    {
      p_target_user_id: userId,
      p_reason: 'runtime-settings-auth-rls-test',
    }
  );

  if (error) {
    throw new Error(`grantPlatformSuperAdmin: ${error.message}`);
  }
}

async function signInAsUser(user: SeededUser) {
  const client = anonSupabase();
  const authResult = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });

  if (authResult.error) {
    throw new Error(`signInAsUser: ${authResult.error.message}`);
  }

  return client;
}

function auditRowsForKey(rows: AuditRow[] | null, key: string, action: string) {
  return (rows ?? []).filter((row) => {
    const payload =
      action === 'settings.runtime.delete' ? row.previous_value : row.new_value;

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return false;
    }

    return (payload as { key?: unknown }).key === key;
  });
}

describeLive(
  'runtime settings SQL RPC auth + RLS boundary (live Supabase)',
  () => {
    it('enforces scope write/read gates and emits audit events for runtime setting mutations', async () => {
      const superAdminUser = await seedTestUser('rs-rpc-super-admin');
      const orgAdminUser = await seedTestUser('rs-rpc-org-admin');
      const spaceAdminUser = await seedTestUser('rs-rpc-space-admin');
      const plainUser = await seedTestUser('rs-rpc-plain-user');

      const runtimeSettingKey = `e2e.runtime.auth_rls.${randomToken()}`;
      let bootstrap: TestBootstrap | undefined;

      try {
        bootstrap = await bootstrapRuntimeSettingsBoundaryFixture({
          orgAdminUserId: orgAdminUser.id,
          spaceAdminUserId: spaceAdminUser.id,
        });
        const fixture = bootstrap;

        await grantPlatformSuperAdmin(superAdminUser.id);

        const superAdminClient = await signInAsUser(superAdminUser);
        const orgAdminClient = await signInAsUser(orgAdminUser);
        const spaceAdminClient = await signInAsUser(spaceAdminUser);
        const plainClient = await signInAsUser(plainUser);
        const serviceClient = serviceSupabase();

        const superAdminGlobalWrite = await superAdminClient.rpc(
          'rpc_set_runtime_setting',
          {
            p_scope: 'global',
            p_key: runtimeSettingKey,
            p_value: 'warn',
            p_value_type: 'string',
            p_is_public: false,
          }
        );

        expect(superAdminGlobalWrite.error).toBeNull();
        expect(typeof superAdminGlobalWrite.data).toBe('string');

        const deniedOrgAdminGlobalWrite = await orgAdminClient.rpc(
          'rpc_set_runtime_setting',
          {
            p_scope: 'global',
            p_key: runtimeSettingKey,
            p_value: 'error',
            p_value_type: 'string',
            p_is_public: false,
          }
        );

        expect(deniedOrgAdminGlobalWrite.error).not.toBeNull();
        expect(deniedOrgAdminGlobalWrite.error?.message).toContain(
          'Not allowed to write runtime settings for this scope'
        );

        const orgAdminOrganizationWrite = await orgAdminClient.rpc(
          'rpc_set_runtime_setting',
          {
            p_scope: 'organization',
            p_scope_id: fixture.organizationId,
            p_key: runtimeSettingKey,
            p_value: 'es',
            p_value_type: 'string',
            p_is_public: false,
          }
        );

        expect(orgAdminOrganizationWrite.error).toBeNull();

        const orgAdminSpaceWrite = await orgAdminClient.rpc(
          'rpc_set_runtime_setting',
          {
            p_scope: 'space',
            p_scope_id: fixture.spaceId,
            p_key: runtimeSettingKey,
            p_value: 'pt',
            p_value_type: 'string',
            p_is_public: false,
          }
        );

        expect(orgAdminSpaceWrite.error).toBeNull();

        const spaceAdminSpaceWrite = await spaceAdminClient.rpc(
          'rpc_set_runtime_setting',
          {
            p_scope: 'space',
            p_scope_id: fixture.spaceId,
            p_key: runtimeSettingKey,
            p_value: 'fr',
            p_value_type: 'string',
            p_is_public: false,
          }
        );

        expect(spaceAdminSpaceWrite.error).toBeNull();

        const deniedSpaceAdminOrganizationWrite = await spaceAdminClient.rpc(
          'rpc_set_runtime_setting',
          {
            p_scope: 'organization',
            p_scope_id: fixture.organizationId,
            p_key: runtimeSettingKey,
            p_value: 'de',
            p_value_type: 'string',
            p_is_public: false,
          }
        );

        expect(deniedSpaceAdminOrganizationWrite.error).not.toBeNull();
        expect(deniedSpaceAdminOrganizationWrite.error?.message).toContain(
          'Not allowed to write runtime settings for this scope'
        );

        const deniedPlainSpaceWrite = await plainClient.rpc(
          'rpc_set_runtime_setting',
          {
            p_scope: 'space',
            p_scope_id: fixture.spaceId,
            p_key: runtimeSettingKey,
            p_value: 'it',
            p_value_type: 'string',
            p_is_public: false,
          }
        );

        expect(deniedPlainSpaceWrite.error).not.toBeNull();
        expect(deniedPlainSpaceWrite.error?.message).toContain(
          'Not allowed to write runtime settings for this scope'
        );

        const superAdminGlobalRead = await superAdminClient
          .from('runtime_settings')
          .select('scope,scope_id,key,value,is_public')
          .eq('key', runtimeSettingKey)
          .eq('scope', 'global');
        expect(superAdminGlobalRead.error).toBeNull();
        expect(superAdminGlobalRead.data).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              scope: 'global',
              scope_id: null,
              key: runtimeSettingKey,
              is_public: false,
            }),
          ])
        );

        const orgAdminGlobalRead = await orgAdminClient
          .from('runtime_settings')
          .select('scope,scope_id,key')
          .eq('key', runtimeSettingKey)
          .eq('scope', 'global');
        expect(orgAdminGlobalRead.error).toBeNull();
        expect(orgAdminGlobalRead.data).toEqual([]);

        const orgAdminOrganizationRead = await orgAdminClient
          .from('runtime_settings')
          .select('scope,scope_id,key,value')
          .eq('key', runtimeSettingKey)
          .eq('scope', 'organization')
          .eq('scope_id', fixture.organizationId);
        expect(orgAdminOrganizationRead.error).toBeNull();
        expect(orgAdminOrganizationRead.data).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              scope: 'organization',
              scope_id: fixture.organizationId,
              key: runtimeSettingKey,
            }),
          ])
        );

        const spaceAdminOrganizationRead = await spaceAdminClient
          .from('runtime_settings')
          .select('scope,scope_id,key')
          .eq('key', runtimeSettingKey)
          .eq('scope', 'organization')
          .eq('scope_id', fixture.organizationId);
        expect(spaceAdminOrganizationRead.error).toBeNull();
        expect(spaceAdminOrganizationRead.data).toEqual([]);

        const spaceAdminSpaceRead = await spaceAdminClient
          .from('runtime_settings')
          .select('scope,scope_id,key,value')
          .eq('key', runtimeSettingKey)
          .eq('scope', 'space')
          .eq('scope_id', fixture.spaceId);
        expect(spaceAdminSpaceRead.error).toBeNull();
        expect(spaceAdminSpaceRead.data).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              scope: 'space',
              scope_id: fixture.spaceId,
              key: runtimeSettingKey,
            }),
          ])
        );

        const plainUserSpaceRead = await plainClient
          .from('runtime_settings')
          .select('scope,scope_id,key')
          .eq('key', runtimeSettingKey)
          .eq('scope', 'space')
          .eq('scope_id', fixture.spaceId);
        expect(plainUserSpaceRead.error).toBeNull();
        expect(plainUserSpaceRead.data).toEqual([]);

        const deleteGlobal = await superAdminClient.rpc(
          'rpc_delete_runtime_setting',
          {
            p_scope: 'global',
            p_key: runtimeSettingKey,
          }
        );
        expect(deleteGlobal.error).toBeNull();
        expect(deleteGlobal.data).toBe(true);

        const deleteOrganization = await orgAdminClient.rpc(
          'rpc_delete_runtime_setting',
          {
            p_scope: 'organization',
            p_scope_id: fixture.organizationId,
            p_key: runtimeSettingKey,
          }
        );
        expect(deleteOrganization.error).toBeNull();
        expect(deleteOrganization.data).toBe(true);

        const deleteSpace = await spaceAdminClient.rpc(
          'rpc_delete_runtime_setting',
          {
            p_scope: 'space',
            p_scope_id: fixture.spaceId,
            p_key: runtimeSettingKey,
          }
        );
        expect(deleteSpace.error).toBeNull();
        expect(deleteSpace.data).toBe(true);

        const { data: auditRows, error: auditError } = await serviceClient
          .from('space_admin_audit_log')
          .select('action,organization_id,space_id,new_value,previous_value')
          .in('action', ['settings.runtime.upsert', 'settings.runtime.delete'])
          .or(
            `organization_id.eq.${fixture.organizationId},organization_id.is.null`
          )
          .order('created_at', { ascending: true });

        expect(auditError).toBeNull();

        const upsertRows = auditRowsForKey(
          (auditRows ?? []) as AuditRow[],
          runtimeSettingKey,
          'settings.runtime.upsert'
        );
        const deleteRows = auditRowsForKey(
          (auditRows ?? []) as AuditRow[],
          runtimeSettingKey,
          'settings.runtime.delete'
        );

        expect(upsertRows.length).toBeGreaterThanOrEqual(3);
        expect(deleteRows.length).toBeGreaterThanOrEqual(3);

        expect(
          upsertRows.some(
            (row) => row.organization_id === null && row.space_id === null
          )
        ).toBe(true);
        expect(
          upsertRows.some(
            (row) =>
              row.organization_id === fixture.organizationId &&
              row.space_id === null
          )
        ).toBe(true);
        expect(upsertRows.some((row) => row.space_id === fixture.spaceId)).toBe(
          true
        );
      } finally {
        await deleteRuntimeSettingsByKey(runtimeSettingKey);

        if (bootstrap) {
          await deleteOrganizationCascade(bootstrap.organizationId);
        }

        await cleanupTestUser(superAdminUser.id);
        await cleanupTestUser(orgAdminUser.id);
        await cleanupTestUser(spaceAdminUser.id);
        await cleanupTestUser(plainUser.id);
      }
    }, 90_000);
  }
);
