import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CRITICAL_CAPABILITY_KEYS,
  hasCriticalCapability,
} from '@workspace/rbac/critical-capability';

import { getIsOrgAdminForUser } from '@/lib/platform-org-admin';
import {
  getIsUserSpaceAdminForSpace,
  getSpaceIdsWhereUserIsSpaceAdmin,
} from '@/lib/platform-space-admin';

export async function getIsSuperAdminForUser(
  supabase: SupabaseClient<Database>,
  _userId: string
): Promise<boolean> {
  return hasCriticalCapability(
    supabase,
    CRITICAL_CAPABILITY_KEYS.platformAdminOverride
  );
}

/**
 * Sidebar Organizations link: org admins and super admins always see it.
 * Space-admin-only users see it only when their active space is one they admin.
 */
export async function getShowOrganizationsNav(
  supabase: SupabaseClient<Database>,
  userId: string,
  activeSpaceId: string | null
): Promise<boolean> {
  const orgAdmin = await getIsOrgAdminForUser(supabase, userId);
  if (orgAdmin) {
    return true;
  }
  if (await getIsSuperAdminForUser(supabase, userId)) {
    return true;
  }
  if (!activeSpaceId) {
    return false;
  }
  return getIsUserSpaceAdminForSpace(supabase, userId, activeSpaceId);
}

/**
 * Sidebar Space settings link: visible only with an active Space.
 * Org admins and super admins can access active-space settings;
 * space-admin-only users can access only when they admin the active space.
 */
export async function getShowSpaceSettingsNav(
  supabase: SupabaseClient<Database>,
  userId: string,
  activeSpaceId: string | null
): Promise<boolean> {
  if (!activeSpaceId) {
    return false;
  }
  const orgAdmin = await getIsOrgAdminForUser(supabase, userId);
  if (orgAdmin) {
    return true;
  }
  if (await getIsSuperAdminForUser(supabase, userId)) {
    return true;
  }
  return getIsUserSpaceAdminForSpace(supabase, userId, activeSpaceId);
}

/** @internal Used by the organizations page to list all spaces the user can manage. */
export { getSpaceIdsWhereUserIsSpaceAdmin };
