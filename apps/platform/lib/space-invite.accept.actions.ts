'use server';

import { revalidatePath } from 'next/cache';

import {
  acceptSpaceInviteForSession,
  setActiveSpaceCookieForInvite,
} from '@/lib/space-invite.accept.server';

export type AcceptSpaceInviteResult =
  | { ok: true; spaceId: string }
  | { ok: false; message: string };

export async function acceptSpaceInviteAction(
  token: string
): Promise<AcceptSpaceInviteResult> {
  const result = await acceptSpaceInviteForSession(token);
  if (result.status === 'unauthenticated') {
    return { ok: false, message: 'Not authenticated.' };
  }
  if (result.status === 'error') {
    return { ok: false, message: result.message };
  }

  await setActiveSpaceCookieForInvite(result.spaceId);

  revalidatePath('/profile');
  revalidatePath('/organizations');
  revalidatePath('/');
  return { ok: true, spaceId: result.spaceId };
}
