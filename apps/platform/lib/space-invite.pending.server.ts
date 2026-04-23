import 'server-only';

import type { Database } from '@workspace/db';
import type { SupabaseClient, User } from '@supabase/supabase-js';

import type { PlatformPendingSpaceInvite } from '@/lib/platform-shell.types';

function getRoleInfo(
  role:
    | { key: string | null; label?: string | null }
    | { key: string | null; label?: string | null }[]
    | null
    | undefined
): { key: string; label: string } | null {
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

export async function loadPendingSpaceInvitesForUser(
  supabase: SupabaseClient<Database>,
  user: User
): Promise<PlatformPendingSpaceInvite[]> {
  const email = user.email?.trim().toLowerCase() ?? '';
  if (email.length === 0) {
    return [];
  }

  const { data: inviteRows } = await supabase
    .from('space_invites')
    .select(
      'id, space_id, token, expires_at, role:roles!space_invites_role_id_fkey(key,label)'
    )
    .eq('status', 'pending')
    .eq('email', email);

  const invList = inviteRows ?? [];
  const spaceIds = [...new Set(invList.map((r) => r.space_id).filter(Boolean))];
  if (spaceIds.length === 0) {
    return [];
  }

  const { data: inviteSpaceRows } = await supabase
    .from('spaces')
    .select('id,name,slug')
    .in('id', spaceIds);

  const spaceMeta = new Map(
    (inviteSpaceRows ?? []).map((s) => [s.id, { name: s.name, slug: s.slug }])
  );

  return invList.flatMap((r) => {
    const meta = spaceMeta.get(r.space_id);
    const roleInfo = getRoleInfo(r.role);
    if (!roleInfo) {
      return [];
    }

    return [
      {
        id: r.id,
        spaceId: r.space_id,
        token: r.token,
        roleKey: roleInfo.key,
        roleLabel: roleInfo.label,
        expiresAt: r.expires_at,
        spaceName: meta?.name ?? 'Space',
        spaceSlug: meta?.slug ?? '',
      },
    ];
  });
}
