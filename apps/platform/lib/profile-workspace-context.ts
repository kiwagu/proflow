import { resolveActiveSpaceDecision } from '@workspace/gateway-auth/resolve-active-space';
import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { readActiveSpaceIdFromCookies } from '@/lib/active-space';

type ProfileWorkspaceRole = {
  key: string;
  label: string;
};

function getRoleInfo(
  role:
    | { key: string | null; label?: string | null }
    | { key: string | null; label?: string | null }[]
    | null
    | undefined
): ProfileWorkspaceRole | null {
  const row = Array.isArray(role) ? role[0] : role;
  const key =
    typeof row?.key === 'string' && row.key.length > 0 ? row.key : null;
  const label =
    typeof row?.label === 'string' && row.label.trim().length > 0
      ? row.label.trim()
      : null;
  if (!key || !label) {
    return null;
  }

  return {
    key,
    label,
  };
}

export type ProfileWorkspaceSpace = {
  spaceId: string;
  name: string;
  slug: string;
  avatarUrl: string | null;
  organizationId: string;
  orgName: string;
  orgSlug: string;
  orgAvatarUrl: string | null;
  orgRoles: ProfileWorkspaceRole[];
  roles: ProfileWorkspaceRole[];
};

export type ProfileWorkspaceContext =
  | { kind: 'empty' }
  | {
      kind: 'ok';
      spaces: ProfileWorkspaceSpace[];
      activeSpace: ProfileWorkspaceSpace | null;
      needsSpaceChoice: false;
    };

/**
 * Loads Space memberships, parent organizations, and active Space (cookie + resolver).
 */
export async function loadProfileWorkspaceContext(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<ProfileWorkspaceContext> {
  const { data: memRows, error } = await supabase
    .from('space_memberships')
    .select('space_id,status')
    .eq('user_id', userId);

  if (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error(
        '[profile-workspace-context] space_memberships:',
        error.message
      );
    }
    return { kind: 'empty' };
  }

  if (!memRows?.length) {
    return { kind: 'empty' };
  }

  const memberships = memRows.map((m) => ({
    space_id: m.space_id,
    status: m.status,
  }));

  const spaceIds = [...new Set(memRows.map((m) => m.space_id))];
  const { data: spaceRows, error: spacesErr } = await supabase
    .from('spaces')
    .select('id,name,slug,avatar_url,organization_id,created_at')
    .in('id', spaceIds)
    .order('created_at', { ascending: true });

  if (spacesErr) {
    if (process.env.NODE_ENV === 'development') {
      console.error('[profile-workspace-context] spaces:', spacesErr.message);
    }
    return { kind: 'empty' };
  }

  if (!spaceRows?.length) {
    return { kind: 'empty' };
  }

  const orgIds = [...new Set(spaceRows.map((s) => s.organization_id))];
  const { data: orgRows } = await supabase
    .from('organizations')
    .select('id,name,slug,avatar_url')
    .in('id', orgIds);

  const orgById = new Map((orgRows ?? []).map((o) => [o.id, o]));

  const { data: userRoleRows } = await supabase
    .from('user_role')
    .select('space_id, roles!inner(key,label)')
    .eq('user_id', userId)
    .in('space_id', spaceIds);

  const rolesBySpaceId = new Map<string, Map<string, string>>();
  for (const row of userRoleRows ?? []) {
    if (!row.space_id) {
      continue;
    }
    const role = getRoleInfo(row.roles);
    if (!role) {
      continue;
    }
    const current =
      rolesBySpaceId.get(row.space_id) ?? new Map<string, string>();
    current.set(role.key, role.label);
    rolesBySpaceId.set(row.space_id, current);
  }

  const { data: orgRoleRows } = await supabase
    .from('user_role')
    .select('organization_id, roles!inner(key,label)')
    .eq('user_id', userId)
    .in('organization_id', orgIds);

  const rolesByOrgId = new Map<string, Map<string, string>>();
  for (const row of orgRoleRows ?? []) {
    if (!row.organization_id) {
      continue;
    }
    const role = getRoleInfo(row.roles);
    if (!role) {
      continue;
    }
    const current =
      rolesByOrgId.get(row.organization_id) ?? new Map<string, string>();
    current.set(role.key, role.label);
    rolesByOrgId.set(row.organization_id, current);
  }

  const spaces: ProfileWorkspaceSpace[] = spaceRows.map((s) => {
    const org = orgById.get(s.organization_id);
    return {
      spaceId: s.id,
      name: s.name,
      slug: s.slug,
      avatarUrl: s.avatar_url,
      organizationId: s.organization_id,
      orgName: org?.name ?? '—',
      orgSlug: org?.slug ?? '',
      orgAvatarUrl: org?.avatar_url ?? null,
      orgRoles: [...(rolesByOrgId.get(s.organization_id) ?? new Map())]
        .map(([key, label]) => ({ key, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      roles: [...(rolesBySpaceId.get(s.id) ?? new Map())]
        .map(([key, label]) => ({ key, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    };
  });

  const spaceById = new Map(spaces.map((s) => [s.spaceId, s]));

  const cookieStore = await cookies();
  const cookieSpaceId = readActiveSpaceIdFromCookies(cookieStore) ?? undefined;
  const activeMembershipSpaceIds = new Set(
    memberships.filter((m) => m.status === 'active').map((m) => m.space_id)
  );
  const defaultSpaceId = spaceRows.find((s) =>
    activeMembershipSpaceIds.has(s.id)
  )?.id;

  const decision = resolveActiveSpaceDecision({
    memberships,
    cookieSpaceId,
    querySpaceSlug: undefined,
    queryResolvesToSpaceId: undefined,
    defaultSpaceId,
  });

  if (decision.kind === 'none') {
    return { kind: 'empty' };
  }

  const activeSpace = spaceById.get(decision.spaceId) ?? null;

  return {
    kind: 'ok',
    spaces,
    activeSpace,
    needsSpaceChoice: false,
  };
}
