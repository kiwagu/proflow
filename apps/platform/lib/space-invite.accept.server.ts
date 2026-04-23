import 'server-only';

import { cookies } from 'next/headers';

import { setCanonicalActiveSpaceCookie } from '@workspace/gateway-auth/active-space.cookie';

import { createClient } from '@/lib/supabase/server';

function getRpcSpaceId(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const spaceId = Reflect.get(value, 'space_id');
  return typeof spaceId === 'string' && spaceId.trim().length > 0
    ? spaceId.trim()
    : null;
}

export type AcceptSpaceInviteSessionResult =
  | { status: 'ok'; spaceId: string }
  | { status: 'unauthenticated' }
  | { status: 'error'; message: string };

export async function acceptSpaceInviteForSession(
  token: string
): Promise<AcceptSpaceInviteSessionResult> {
  const trimmed = token.trim();
  if (!trimmed) {
    return { status: 'error', message: 'Invite token is required.' };
  }

  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return { status: 'unauthenticated' };
  }

  const { data, error } = await supabase.rpc('rpc_accept_space_invite', {
    p_token: trimmed,
  });

  if (error) {
    // Invite may have already been accepted earlier in the flow.
    // If the user is already a member of the invite's space, treat as success.
    const { data: inviteRow } = await supabase
      .from('space_invites')
      .select('space_id')
      .eq('token', trimmed)
      .maybeSingle();

    const spaceId = inviteRow?.space_id?.trim();
    if (spaceId) {
      const { data: membership } = await supabase
        .from('space_memberships')
        .select('space_id')
        .eq('user_id', userData.user.id)
        .eq('space_id', spaceId)
        .eq('status', 'active')
        .maybeSingle();

      if (membership) {
        return { status: 'ok', spaceId };
      }
    }

    return {
      status: 'error',
      message:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Could not accept this invite.',
    };
  }

  const spaceId = getRpcSpaceId(data);
  if (!spaceId) {
    return { status: 'error', message: 'Unexpected response from server.' };
  }

  return { status: 'ok', spaceId };
}

export async function setActiveSpaceCookieForInvite(
  spaceId: string
): Promise<void> {
  const store = await cookies();
  setCanonicalActiveSpaceCookie(store, spaceId);
}
