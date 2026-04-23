'use server';

import { createClient } from '@/lib/supabase/server';

import {
  spaceInviteSetPasswordSchema,
  type SpaceInviteSetPasswordValues,
} from '@/lib/space-invite.set-password.schema';

export type SetPasswordForSpaceInviteResult =
  | { ok: true; nextPath: string }
  | { ok: false; message: string };

/**
 * Sets password for the signed-in invitee, then client navigates to invite/complete.
 */
export async function setPasswordForSpaceInviteAction(
  inviteToken: string,
  values: SpaceInviteSetPasswordValues
): Promise<SetPasswordForSpaceInviteResult> {
  const trimmedToken = inviteToken.trim();
  if (!trimmedToken) {
    return { ok: false, message: 'Missing invite token.' };
  }

  const parsed = spaceInviteSetPasswordSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }

  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user?.email) {
    return { ok: false, message: 'Not authenticated.' };
  }

  const sessionEmail = userData.user.email.trim().toLowerCase();

  const { data: invite, error: invErr } = await supabase
    .from('space_invites')
    .select('id,email,status,expires_at,token')
    .eq('token', trimmedToken)
    .maybeSingle();

  if (invErr || !invite) {
    return { ok: false, message: 'Invite not found or not accessible.' };
  }

  if (invite.status !== 'pending') {
    return { ok: false, message: 'This invite is no longer valid.' };
  }

  const expiresAt = new Date(invite.expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
    return { ok: false, message: 'This invite has expired.' };
  }

  if (invite.email.trim().toLowerCase() !== sessionEmail) {
    return {
      ok: false,
      message: 'Signed-in email does not match this invite.',
    };
  }

  const { error: upErr } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (upErr) {
    return {
      ok: false,
      message:
        process.env.NODE_ENV === 'development'
          ? upErr.message
          : 'Could not set password.',
    };
  }

  const nextPath = `/invite/complete?t=${encodeURIComponent(trimmedToken)}`;

  return { ok: true, nextPath };
}
