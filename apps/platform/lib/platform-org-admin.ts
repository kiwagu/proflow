import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';

/** True if the user has at least one org-admin assignment in user_role. */
export async function getIsOrgAdminForUser(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_role')
    .select(
      'organization_id, roles!inner(key,role_kind,owner_organization_id,archived_at)'
    )
    .eq('user_id', userId)
    .not('organization_id', 'is', null)
    .eq('roles.key', 'org_admin')
    .eq('roles.role_kind', 'system')
    .is('roles.owner_organization_id', null)
    .is('roles.archived_at', null)
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return false;
  }
  return true;
}

/** True when the user may create a new Space (org_admin in at least one organization). */
export async function getCanUserCreateOrganizationSpace(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<boolean> {
  return getIsOrgAdminForUser(supabase, userId);
}

/** True if the user is org-admin for one specific organization. */
export async function getIsOrgAdminForOrganization(
  supabase: SupabaseClient<Database>,
  userId: string,
  organizationId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_role')
    .select(
      'organization_id, roles!inner(key,role_kind,owner_organization_id,archived_at)'
    )
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .eq('roles.key', 'org_admin')
    .eq('roles.role_kind', 'system')
    .is('roles.owner_organization_id', null)
    .is('roles.archived_at', null)
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return false;
  }
  return true;
}
