import { createClient } from '@supabase/supabase-js';

import { resolveServiceRoleKey, resolveSupabaseUrl } from './test-user.js';

const PLATFORM_FEATURE_FLAG_ORGANIZATION_SETTINGS_KEY =
  'platform.feature_flag.organization_settings';

export type E2EPlatformOrgBootstrap = {
  organizationId: string;
  spaceId: string;
};

export type E2EPlatformSpaceBootstrap = {
  spaceId: string;
};

function serviceSupabase() {
  return createClient(resolveSupabaseUrl(), resolveServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function resolveGlobalOrganizationSettingsTemplate(): Promise<boolean> {
  const supabase = serviceSupabase();
  const { data, error } = await supabase
    .from('runtime_settings')
    .select('value')
    .eq('scope', 'global')
    .is('scope_id', null)
    .eq('key', PLATFORM_FEATURE_FLAG_ORGANIZATION_SETTINGS_KEY)
    .maybeSingle();

  if (error) {
    throw new Error(
      `platform-org-bootstrap: failed to resolve global org-settings template: ${error.message}`
    );
  }

  return typeof data?.value === 'boolean' ? data.value : false;
}

async function seedOrganizationFeatureDefaults(
  organizationId: string,
  userId: string
): Promise<void> {
  const supabase = serviceSupabase();
  const organizationSettingsEnabled =
    await resolveGlobalOrganizationSettingsTemplate();

  const { error } = await supabase.from('runtime_settings').upsert(
    {
      scope: 'organization',
      scope_id: organizationId,
      key: PLATFORM_FEATURE_FLAG_ORGANIZATION_SETTINGS_KEY,
      value: organizationSettingsEnabled,
      value_type: 'boolean',
      is_public: false,
      created_by_user_id: userId,
      updated_by_user_id: userId,
    },
    {
      onConflict: 'scope,key,scope_target',
    }
  );

  if (error) {
    throw new Error(
      `platform-org-bootstrap: failed to seed org feature defaults: ${error.message}`
    );
  }
}

async function requireRoleIds() {
  const supabase = serviceSupabase();
  const { data: roleRows, error: roleErr } = await supabase
    .from('roles')
    .select('id,key')
    .in('key', ['org_admin', 'space_admin']);

  if (roleErr) {
    throw new Error(
      `platform-org-bootstrap: failed roles lookup: ${roleErr.message}`
    );
  }

  const roleByKey = new Map((roleRows ?? []).map((r) => [r.key, r.id]));
  const orgAdminRoleId = roleByKey.get('org_admin');
  const spaceAdminRoleId = roleByKey.get('space_admin');
  if (!orgAdminRoleId || !spaceAdminRoleId) {
    throw new Error(
      'platform-org-bootstrap: required roles org_admin/space_admin missing'
    );
  }

  return { orgAdminRoleId, spaceAdminRoleId };
}

/**
 * Creates an organization, org_admin membership, space, and space admin row so the
 * user can open /platform/organizations and manage invites. Caller should delete
 * the organization after tests to cascade cleanup.
 */
export async function bootstrapOrgSpaceAdminForUser(
  userId: string
): Promise<E2EPlatformOrgBootstrap> {
  const supabase = serviceSupabase();
  const slug = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .insert({ name: `E2E Org ${slug}`, slug })
    .select('id')
    .single();

  if (orgErr || !org?.id) {
    throw new Error(
      `bootstrapOrgSpaceAdminForUser: failed to create org: ${orgErr?.message ?? 'no id'}`
    );
  }

  await seedOrganizationFeatureDefaults(org.id, userId);

  const { error: omErr } = await supabase
    .from('organization_memberships')
    .insert({
      organization_id: org.id,
      user_id: userId,
    });

  if (omErr) {
    throw new Error(
      `bootstrapOrgSpaceAdminForUser: failed org membership: ${omErr.message}`
    );
  }

  const spaceSlug = `spc-${slug}`;
  const { data: space, error: spErr } = await supabase
    .from('spaces')
    .insert({
      organization_id: org.id,
      name: 'E2E Space',
      slug: spaceSlug,
    })
    .select('id')
    .single();

  if (spErr || !space?.id) {
    throw new Error(
      `bootstrapOrgSpaceAdminForUser: failed to create space: ${spErr?.message ?? 'no id'}`
    );
  }

  const { error: smErr } = await supabase.from('space_memberships').insert({
    space_id: space.id,
    user_id: userId,
    status: 'active',
  });

  if (smErr) {
    throw new Error(
      `bootstrapOrgSpaceAdminForUser: failed space membership: ${smErr.message}`
    );
  }

  const { orgAdminRoleId, spaceAdminRoleId } = await requireRoleIds();

  const { error: urErr } = await supabase.from('user_role').insert([
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
    throw new Error(
      `bootstrapOrgSpaceAdminForUser: failed role assignment: ${urErr.message}`
    );
  }

  return { organizationId: org.id, spaceId: space.id };
}

export async function bootstrapSpaceAdminOnlyForUser(
  userId: string
): Promise<E2EPlatformOrgBootstrap> {
  const supabase = serviceSupabase();
  const slug = `e2e-space-admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .insert({ name: `E2E SpaceAdmin Org ${slug}`, slug })
    .select('id')
    .single();

  if (orgErr || !org?.id) {
    throw new Error(
      `bootstrapSpaceAdminOnlyForUser: failed to create org: ${orgErr?.message ?? 'no id'}`
    );
  }

  await seedOrganizationFeatureDefaults(org.id, userId);

  const { error: omErr } = await supabase
    .from('organization_memberships')
    .insert({
      organization_id: org.id,
      user_id: userId,
    });

  if (omErr) {
    throw new Error(
      `bootstrapSpaceAdminOnlyForUser: failed org membership: ${omErr.message}`
    );
  }

  const { data: space, error: spErr } = await supabase
    .from('spaces')
    .insert({
      organization_id: org.id,
      name: 'E2E Space Admin Only Space',
      slug: `spc-${slug}`,
    })
    .select('id')
    .single();

  if (spErr || !space?.id) {
    throw new Error(
      `bootstrapSpaceAdminOnlyForUser: failed to create space: ${spErr?.message ?? 'no id'}`
    );
  }

  const { error: smErr } = await supabase.from('space_memberships').insert({
    space_id: space.id,
    user_id: userId,
    status: 'active',
  });

  if (smErr) {
    throw new Error(
      `bootstrapSpaceAdminOnlyForUser: failed space membership: ${smErr.message}`
    );
  }

  const { spaceAdminRoleId } = await requireRoleIds();
  const { error: urErr } = await supabase.from('user_role').insert({
    user_id: userId,
    space_id: space.id,
    role_id: spaceAdminRoleId,
  });

  if (urErr) {
    throw new Error(
      `bootstrapSpaceAdminOnlyForUser: failed role assignment: ${urErr.message}`
    );
  }

  return { organizationId: org.id, spaceId: space.id };
}

export async function setOrganizationSettingsFeatureRollout(input: {
  organizationId: string;
  spaceId: string;
  userId: string;
  organizationEnabled: boolean;
  spaceEnabled: boolean;
}): Promise<void> {
  const supabase = serviceSupabase();
  const { organizationId, spaceId, userId, organizationEnabled, spaceEnabled } =
    input;

  const { error } = await supabase.from('runtime_settings').upsert(
    [
      {
        scope: 'organization',
        scope_id: organizationId,
        key: PLATFORM_FEATURE_FLAG_ORGANIZATION_SETTINGS_KEY,
        value: organizationEnabled,
        value_type: 'boolean',
        is_public: false,
        created_by_user_id: userId,
        updated_by_user_id: userId,
      },
      {
        scope: 'space',
        scope_id: spaceId,
        key: PLATFORM_FEATURE_FLAG_ORGANIZATION_SETTINGS_KEY,
        value: spaceEnabled,
        value_type: 'boolean',
        is_public: false,
        created_by_user_id: userId,
        updated_by_user_id: userId,
      },
    ],
    {
      onConflict: 'scope,key,scope_target',
    }
  );

  if (error) {
    throw new Error(
      `setOrganizationSettingsFeatureRollout: failed to update runtime settings: ${error.message}`
    );
  }
}

export async function bootstrapAdditionalSpaceAdminForUser(input: {
  organizationId: string;
  userId: string;
  spaceName: string;
  slugPrefix?: string;
}): Promise<E2EPlatformSpaceBootstrap> {
  const supabase = serviceSupabase();
  const { organizationId, userId, spaceName, slugPrefix = 'spc' } = input;
  const slug = `${slugPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const { data: space, error: spErr } = await supabase
    .from('spaces')
    .insert({
      organization_id: organizationId,
      name: spaceName,
      slug,
    })
    .select('id')
    .single();

  if (spErr || !space?.id) {
    throw new Error(
      `bootstrapAdditionalSpaceAdminForUser: failed to create space: ${spErr?.message ?? 'no id'}`
    );
  }

  const { error: smErr } = await supabase.from('space_memberships').insert({
    space_id: space.id,
    user_id: userId,
    status: 'active',
  });

  if (smErr) {
    throw new Error(
      `bootstrapAdditionalSpaceAdminForUser: failed space membership: ${smErr.message}`
    );
  }

  const { spaceAdminRoleId } = await requireRoleIds();
  const { error: roleAssignErr } = await supabase.from('user_role').insert({
    user_id: userId,
    space_id: space.id,
    role_id: spaceAdminRoleId,
  });

  if (roleAssignErr) {
    throw new Error(
      `bootstrapAdditionalSpaceAdminForUser: failed role assignment: ${roleAssignErr.message}`
    );
  }

  return { spaceId: space.id };
}

export async function deleteOrganizationCascade(
  organizationId: string
): Promise<void> {
  const supabase = serviceSupabase();
  const { data: spaceRows, error: spaceErr } = await supabase
    .from('spaces')
    .select('id')
    .eq('organization_id', organizationId);

  if (spaceErr) {
    throw new Error(`deleteOrganizationCascade: ${spaceErr.message}`);
  }

  const spaceIds = (spaceRows ?? []).map((space) => space.id);

  const { error: deleteOrgSettingsErr } = await supabase
    .from('runtime_settings')
    .delete()
    .eq('scope', 'organization')
    .eq('scope_id', organizationId);

  if (deleteOrgSettingsErr) {
    throw new Error(
      `deleteOrganizationCascade: ${deleteOrgSettingsErr.message}`
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
        `deleteOrganizationCascade: ${deleteSpaceSettingsErr.message}`
      );
    }
  }

  const { error } = await supabase
    .from('organizations')
    .delete()
    .eq('id', organizationId);
  if (error) {
    throw new Error(`deleteOrganizationCascade: ${error.message}`);
  }
}
