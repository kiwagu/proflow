import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * True when the user has no organization membership yet — first-time bootstrap
 * (create organization + first Space) is required. Matches onboarding page guard.
 *
 * Users with a pending space invite (same email as session) skip bootstrap and use
 * profile + accept-invite instead.
 */
export async function userNeedsOrganizationBootstrap(
  supabase: SupabaseClient<Database>,
  userId: string,
  sessionEmail?: string | null
): Promise<boolean> {
  const { count, error } = await supabase
    .from('organization_memberships')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error(
        '[userNeedsOrganizationBootstrap] organization_memberships:',
        error.message
      );
    }
    return true;
  }

  if ((count ?? 0) > 0) {
    return false;
  }

  const normalized = sessionEmail?.trim().toLowerCase() ?? '';
  if (normalized.length > 0) {
    const { count: inviteCount, error: inviteErr } = await supabase
      .from('space_invites')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .eq('email', normalized);

    if (inviteErr) {
      if (process.env.NODE_ENV === 'development') {
        console.error(
          '[userNeedsOrganizationBootstrap] space_invites:',
          inviteErr.message
        );
      }
      return true;
    }

    if ((inviteCount ?? 0) > 0) {
      return false;
    }
  }

  return true;
}
