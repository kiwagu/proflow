import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Database } from '@workspace/db';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

const PLATFORM_FEATURE_FLAG_ORGANIZATION_SETTINGS_KEY =
  'platform.feature_flag.organization_settings';

type SeededUser = {
  id: string;
  email: string;
  password: string;
};

type TestBootstrap = {
  organizationId: string;
  spaceId: string;
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

async function bootstrapFeatureFlagBoundaryFixture(input: {
  orgAdminUserId: string;
  spaceAdminUserId: string;
}): Promise<TestBootstrap> {
  const supabase = serviceSupabase();
  const { orgAdminRoleId, spaceAdminRoleId } = await requireSystemRoleIds();
  const slug = `ff-rpc-${randomToken()}`;

  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .insert({
      name: `Feature Flag RPC ${slug}`,
      slug,
    })
    .select('id')
    .single();

  if (orgErr || !org?.id) {
    throw new Error(
      `bootstrapFeatureFlagBoundaryFixture org: ${orgErr?.message ?? 'missing id'}`
    );
  }

  const { data: space, error: spaceErr } = await supabase
    .from('spaces')
    .insert({
      organization_id: org.id,
      name: 'Feature Flag RPC Space',
      slug: `spc-${slug}`,
    })
    .select('id')
    .single();

  if (spaceErr || !space?.id) {
    throw new Error(
      `bootstrapFeatureFlagBoundaryFixture space: ${spaceErr?.message ?? 'missing id'}`
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
      `bootstrapFeatureFlagBoundaryFixture org membership: ${orgMembershipErr.message}`
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
      `bootstrapFeatureFlagBoundaryFixture space membership: ${spaceMembershipErr.message}`
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
      `bootstrapFeatureFlagBoundaryFixture roles: ${roleErr.message}`
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

describeLive('feature-flag SQL RPC boundary (live Supabase)', () => {
  it('allows org-admin writes through the dedicated RPC and rejects space-admin/generic runtime writes', async () => {
    const orgAdminUser = await seedTestUser('ff-rpc-org-admin');
    const spaceAdminUser = await seedTestUser('ff-rpc-space-admin');
    let bootstrap: TestBootstrap | undefined;

    try {
      bootstrap = await bootstrapFeatureFlagBoundaryFixture({
        orgAdminUserId: orgAdminUser.id,
        spaceAdminUserId: spaceAdminUser.id,
      });

      const orgAdminClient = await signInAsUser(orgAdminUser);
      const spaceAdminClient = await signInAsUser(spaceAdminUser);
      const serviceClient = serviceSupabase();

      const organizationWrite = await orgAdminClient.rpc(
        'rpc_set_platform_feature_flag',
        {
          p_scope: 'organization',
          p_scope_id: bootstrap.organizationId,
          p_key: PLATFORM_FEATURE_FLAG_ORGANIZATION_SETTINGS_KEY,
          p_enabled: true,
        }
      );

      expect(organizationWrite.error).toBeNull();
      expect(typeof organizationWrite.data).toBe('string');

      const spaceWrite = await orgAdminClient.rpc(
        'rpc_set_platform_feature_flag',
        {
          p_scope: 'space',
          p_scope_id: bootstrap.spaceId,
          p_key: PLATFORM_FEATURE_FLAG_ORGANIZATION_SETTINGS_KEY,
          p_enabled: true,
        }
      );

      expect(spaceWrite.error).toBeNull();
      expect(typeof spaceWrite.data).toBe('string');

      const deniedSpaceAdminWrite = await spaceAdminClient.rpc(
        'rpc_set_platform_feature_flag',
        {
          p_scope: 'space',
          p_scope_id: bootstrap.spaceId,
          p_key: PLATFORM_FEATURE_FLAG_ORGANIZATION_SETTINGS_KEY,
          p_enabled: false,
        }
      );

      expect(deniedSpaceAdminWrite.error).not.toBeNull();
      expect(deniedSpaceAdminWrite.error?.message).toContain(
        'Not allowed to write feature flags for this scope'
      );

      const genericSetWrite = await orgAdminClient.rpc(
        'rpc_set_runtime_setting',
        {
          p_scope: 'space',
          p_scope_id: bootstrap.spaceId,
          p_key: PLATFORM_FEATURE_FLAG_ORGANIZATION_SETTINGS_KEY,
          p_value: true,
          p_value_type: 'boolean',
          p_is_public: false,
        }
      );

      expect(genericSetWrite.error).not.toBeNull();
      expect(genericSetWrite.error?.message).toContain(
        'Feature flags use the dedicated feature-flag mutation entrypoint'
      );

      const genericDeleteWrite = await orgAdminClient.rpc(
        'rpc_delete_runtime_setting',
        {
          p_scope: 'space',
          p_scope_id: bootstrap.spaceId,
          p_key: PLATFORM_FEATURE_FLAG_ORGANIZATION_SETTINGS_KEY,
        }
      );

      expect(genericDeleteWrite.error).not.toBeNull();
      expect(genericDeleteWrite.error?.message).toContain(
        'Feature flags use the dedicated feature-flag mutation entrypoint'
      );

      const { data: runtimeSettings, error: runtimeSettingsError } =
        await serviceClient
          .from('runtime_settings')
          .select('scope,scope_id,value,value_type,is_public')
          .eq('key', PLATFORM_FEATURE_FLAG_ORGANIZATION_SETTINGS_KEY)
          .in('scope', ['organization', 'space'])
          .order('scope', { ascending: true });

      expect(runtimeSettingsError).toBeNull();
      expect(runtimeSettings).toEqual(
        expect.arrayContaining([
          {
            scope: 'organization',
            scope_id: bootstrap.organizationId,
            value: true,
            value_type: 'boolean',
            is_public: false,
          },
          {
            scope: 'space',
            scope_id: bootstrap.spaceId,
            value: true,
            value_type: 'boolean',
            is_public: false,
          },
        ])
      );

      const { data: auditRows, error: auditError } = await serviceClient
        .from('space_admin_audit_log')
        .select('action,organization_id,space_id')
        .eq('action', 'feature_flag.upsert')
        .eq('organization_id', bootstrap.organizationId);

      expect(auditError).toBeNull();
      expect(auditRows).toEqual(
        expect.arrayContaining([
          {
            action: 'feature_flag.upsert',
            organization_id: bootstrap.organizationId,
            space_id: null,
          },
          {
            action: 'feature_flag.upsert',
            organization_id: bootstrap.organizationId,
            space_id: bootstrap.spaceId,
          },
        ])
      );
    } finally {
      if (bootstrap) {
        await deleteOrganizationCascade(bootstrap.organizationId);
      }

      await cleanupTestUser(orgAdminUser.id);
      await cleanupTestUser(spaceAdminUser.id);
    }
  }, 60_000);
});
