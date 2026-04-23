import 'server-only';

import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';

const LIST_PER_PAGE = 200;
const MAX_PAGES = 25;

export type ResolvedAuthUserByEmail = Readonly<{
  id: string;
  email: string | null;
  last_sign_in_at: string | null;
}>;

/**
 * Finds an Auth user by email (case-insensitive). Uses paginated admin listUsers;
 * acceptable for POC / moderate user counts. Replace with a direct admin filter
 * when the hosted GoTrue version exposes email query on list users.
 */
export async function resolveAuthUserByEmail(
  admin: SupabaseClient<Database>,
  email: string
): Promise<ResolvedAuthUserByEmail | null> {
  const target = email.trim().toLowerCase();
  if (!target) {
    return null;
  }

  let page = 1;
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: LIST_PER_PAGE,
    });
    if (error || !data?.users) {
      return null;
    }
    const u = data.users.find(
      (row) => row.email?.trim().toLowerCase() === target
    );
    if (u) {
      return {
        id: u.id,
        email: u.email?.trim().toLowerCase() ?? null,
        last_sign_in_at: u.last_sign_in_at ?? null,
      };
    }
    const next = data.nextPage;
    if (next == null || next === page) {
      return null;
    }
    page = next;
  }
  return null;
}

export async function resolveAuthUserForSpaceInviteEmail(
  admin: SupabaseClient<Database>,
  email: string
): Promise<ResolvedAuthUserByEmail | null> {
  return resolveAuthUserByEmail(admin, email);
}

/**
 * First-time invitees: no Auth row yet, or account exists but user has never signed in.
 */
export function spaceInviteeNeedsPasswordStep(
  authUser: { last_sign_in_at: string | null } | null
): boolean {
  if (authUser === null) {
    return true;
  }
  const v = authUser.last_sign_in_at;
  return v == null || v === '';
}
