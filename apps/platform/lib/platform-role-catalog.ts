import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CRITICAL_CAPABILITY_KEYS,
  hasCriticalCapability,
} from '@workspace/rbac/critical-capability';

import { getIsOrgAdminForOrganization } from '@/lib/platform-org-admin';
import { getIsUserSpaceAdminForSpace } from '@/lib/platform-space-admin';

export type PlatformInvitableRoleOption = Readonly<{
  key: string;
  label: string;
}>;

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function orderRoleOptions(
  roles: readonly PlatformInvitableRoleOption[]
): PlatformInvitableRoleOption[] {
  return [...roles].sort((a, b) => {
    if (a.key === 'member') {
      return -1;
    }
    if (b.key === 'member') {
      return 1;
    }
    return a.label.localeCompare(b.label);
  });
}

export async function listInvitableSpaceRolesForUser(
  supabase: SupabaseClient<Database>,
  userId: string,
  spaceId: string
): Promise<PlatformInvitableRoleOption[]> {
  const { data: spaceRow, error: spaceErr } = await supabase
    .from('spaces')
    .select('organization_id')
    .eq('id', spaceId)
    .maybeSingle();

  if (spaceErr || !spaceRow?.organization_id) {
    return [];
  }

  const organizationId = String(spaceRow.organization_id);

  const [isCriticalOverride, isOrgAdmin, isSpaceAdmin] = await Promise.all([
    hasCriticalCapability(
      supabase,
      CRITICAL_CAPABILITY_KEYS.platformAdminOverride
    ),
    getIsOrgAdminForOrganization(supabase, userId, organizationId),
    getIsUserSpaceAdminForSpace(supabase, userId, spaceId),
  ]);

  if (!isCriticalOverride && !isOrgAdmin && !isSpaceAdmin) {
    return [];
  }

  if (!isCriticalOverride && !isOrgAdmin) {
    return [
      {
        key: 'member',
        label: 'Member',
      },
    ];
  }

  const { data: roleRows, error: roleErr } = await supabase
    .from('roles')
    .select('key, label, owner_organization_id, archived_at')
    .eq('scope', 'space')
    .is('archived_at', null)
    .or(
      `owner_organization_id.is.null,owner_organization_id.eq.${organizationId}`
    )
    .order('owner_organization_id', { ascending: true })
    .order('label', { ascending: true });

  if (roleErr) {
    return [];
  }

  const dedup = new Map<string, PlatformInvitableRoleOption>();
  for (const row of roleRows ?? []) {
    const key = normalizeText(row.key);
    if (!key || dedup.has(key)) {
      continue;
    }
    const label = normalizeText(row.label) ?? key;
    dedup.set(key, { key, label });
  }

  return orderRoleOptions([...dedup.values()]);
}
