'use server';

import { cookies } from 'next/headers';

import { signOutPlatformSession } from './signout.server';

/**
 * Server Action for logout.
 *
 * Server Actions are the only reliable way to clear httpOnly cookies (e.g.
 * pf_active_space_id) and Supabase session cookies in the same response —
 * cookies() mutations are guaranteed to merge into the action's redirect.
 */
export async function signOutAction() {
  const cookieStore = await cookies();

  await signOutPlatformSession(cookieStore);
}
