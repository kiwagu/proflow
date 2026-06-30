'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { listInvitableSpaceRolesForUser } from '@/lib/platform-role-catalog';
import { createClient } from '@/lib/supabase/server';

export type SpaceMemberRoleOption = Readonly<{
  key: string;
  label: string;
}>;

export type SpaceMemberAssignedRole = Readonly<{
  key: string;
  label: string;
}>;

export type SpaceMemberRoleAssignmentRow = Readonly<{
  userId: string;
  email: string | null;
  displayName: string | null;
  assignedRoles: SpaceMemberAssignedRole[];
  selectedRoleKey: string;
}>;

export type ListSpaceMemberRoleAssignmentsResult =
  | {
      ok: true;
      roleOptions: SpaceMemberRoleOption[];
      members: SpaceMemberRoleAssignmentRow[];
    }
  | { ok: false; message: string };

export type SetSpaceMemberRoleResult =
  { ok: true } | { ok: false; message: string };

const setSpaceMemberRoleSchema = z
  .object({
    spaceId: z
      .string()
      .trim()
      .regex(
        /^[a-z][a-z0-9]{1,15}_[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{16}\.[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{10}$/,
        'Invalid space id.'
      ),
    targetUserId: z.string().trim().uuid('Invalid user id.'),
    roleKey: z.string().trim().min(1, 'Role is required.'),
  })
  .strict();

function extractRoleKey(value: unknown): string | null {
  if (Array.isArray(value)) {
    return extractRoleKey(value[0]);
  }
  if (!value || typeof value !== 'object') {
    return null;
  }

  const key = Reflect.get(value, 'key');
  if (typeof key !== 'string') {
    return null;
  }

  const normalizedKey = key.trim();
  return normalizedKey.length > 0 ? normalizedKey : null;
}

function extractRoleInfo(value: unknown): SpaceMemberAssignedRole | null {
  if (Array.isArray(value)) {
    return extractRoleInfo(value[0]);
  }
  if (!value || typeof value !== 'object') {
    return null;
  }

  const key = extractRoleKey(value);
  const label = Reflect.get(value, 'label');
  if (!key || typeof label !== 'string') {
    return null;
  }

  const normalizedLabel = label.trim();
  if (normalizedLabel.length === 0) {
    return null;
  }

  return { key, label: normalizedLabel };
}

function normalizeRoleInfoRows(
  rows: readonly unknown[]
): SpaceMemberAssignedRole[] {
  const rolesByKey = new Map<string, string>();
  for (const row of rows) {
    const roleValue =
      row && typeof row === 'object' ? Reflect.get(row, 'roles') : row;
    const role = extractRoleInfo(roleValue);
    if (!role) {
      continue;
    }
    rolesByKey.set(role.key, role.label);
  }

  return [...rolesByKey.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function listSpaceMemberRoleAssignmentsAction(
  spaceId: string
): Promise<ListSpaceMemberRoleAssignmentsResult> {
  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return { ok: false, message: 'Not authenticated.' };
  }

  const roleOptions = await listInvitableSpaceRolesForUser(
    supabase,
    userData.user.id,
    spaceId
  );

  if (roleOptions.length === 0) {
    return { ok: false, message: 'Not allowed to manage member roles.' };
  }

  const defaultRoleKey =
    roleOptions.find((role) => role.key === 'member')?.key ??
    roleOptions[0]?.key ??
    'member';
  const allowedRoleKeys = new Set(roleOptions.map((role) => role.key));

  const { data: membershipRows, error: membershipErr } = await supabase
    .from('space_memberships')
    .select('user_id')
    .eq('space_id', spaceId)
    .eq('status', 'active');

  if (membershipErr) {
    return { ok: false, message: 'Could not load space memberships.' };
  }

  const memberUserIds = [
    ...new Set(
      (membershipRows ?? [])
        .map((row) => row.user_id)
        .filter((userId): userId is string => Boolean(userId))
    ),
  ];

  if (memberUserIds.length === 0) {
    return { ok: true, roleOptions, members: [] };
  }

  const [{ data: profileRows }, { data: userRoleRows }] = await Promise.all([
    supabase
      .from('profiles')
      .select('user_id,email,display_name')
      .in('user_id', memberUserIds),
    supabase
      .from('user_role')
      .select('user_id, roles!inner(key,label)')
      .eq('space_id', spaceId)
      .in('user_id', memberUserIds)
      .eq('roles.scope', 'space')
      .is('roles.archived_at', null),
  ]);

  const profileByUserId = new Map(
    (profileRows ?? []).map((row) => [
      row.user_id,
      {
        email: row.email,
        displayName: row.display_name,
      },
    ])
  );

  const roleRowsByUserId = new Map<string, Array<{ roles: unknown }>>();
  for (const row of userRoleRows ?? []) {
    const existing = roleRowsByUserId.get(row.user_id) ?? [];
    existing.push({ roles: row.roles });
    roleRowsByUserId.set(row.user_id, existing);
  }

  const members: SpaceMemberRoleAssignmentRow[] = memberUserIds
    .map((userId) => {
      const profile = profileByUserId.get(userId);
      const assignedRoles = normalizeRoleInfoRows(
        roleRowsByUserId.get(userId) ?? []
      );
      const selectedRoleKey =
        assignedRoles.find((role) => allowedRoleKeys.has(role.key))?.key ??
        defaultRoleKey;

      return {
        userId,
        email: profile?.email ?? null,
        displayName: profile?.displayName ?? null,
        assignedRoles,
        selectedRoleKey,
      };
    })
    .sort((a, b) => {
      const aLabel = (a.displayName ?? a.email ?? a.userId).toLowerCase();
      const bLabel = (b.displayName ?? b.email ?? b.userId).toLowerCase();
      return aLabel.localeCompare(bLabel);
    });

  return { ok: true, roleOptions, members };
}

export async function setSpaceMemberRoleAction(
  values: z.input<typeof setSpaceMemberRoleSchema>
): Promise<SetSpaceMemberRoleResult> {
  const parsed = setSpaceMemberRoleSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }

  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return { ok: false, message: 'Not authenticated.' };
  }

  const { spaceId, targetUserId, roleKey } = parsed.data;

  const { data: spaceRow, error: spaceErr } = await supabase
    .from('spaces')
    .select('organization_id')
    .eq('id', spaceId)
    .maybeSingle();
  if (spaceErr || !spaceRow) {
    return { ok: false, message: 'Space not found.' };
  }

  const allowedRoleKeys = new Set(
    (
      await listInvitableSpaceRolesForUser(supabase, userData.user.id, spaceId)
    ).map((role) => role.key)
  );
  if (!allowedRoleKeys.has(roleKey)) {
    return {
      ok: false,
      message: 'Selected role is not allowed for this Space.',
    };
  }

  const { data: membershipRow, error: membershipErr } = await supabase
    .from('space_memberships')
    .select('user_id')
    .eq('space_id', spaceId)
    .eq('user_id', targetUserId)
    .eq('status', 'active')
    .maybeSingle();

  if (membershipErr || !membershipRow) {
    return {
      ok: false,
      message: 'User is not an active member of this Space.',
    };
  }

  const { error } = await supabase.rpc('rpc_set_space_member_role', {
    p_space_id: spaceId,
    p_target_user_id: targetUserId,
    p_role_key: roleKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Could not assign role.',
    };
  }

  revalidatePath('/space-settings');
  revalidatePath('/organizations');

  return { ok: true };
}
