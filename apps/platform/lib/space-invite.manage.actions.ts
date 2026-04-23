'use server';

import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';
import { listInvitableSpaceRolesForUser } from '@/lib/platform-role-catalog';

import {
  spaceInviteCreateSchema,
  type SpaceInviteCreateFormValues,
} from '@/lib/space-invite.schema';

function parseInviteRpcResult(value: unknown): {
  inviteId: string;
  token: string;
  expiresAt: string;
} | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const inviteId = Reflect.get(value, 'id');
  const token = Reflect.get(value, 'token');
  const expiresAt = Reflect.get(value, 'expires_at');

  if (
    typeof inviteId !== 'string' ||
    typeof token !== 'string' ||
    typeof expiresAt !== 'string'
  ) {
    return null;
  }

  const trimmedInviteId = inviteId.trim();
  const trimmedToken = token.trim();
  if (!trimmedInviteId || !trimmedToken || !expiresAt) {
    return null;
  }

  return {
    inviteId: trimmedInviteId,
    token: trimmedToken,
    expiresAt,
  };
}

export type CreateSpaceInviteResult =
  | { ok: true; token: string; inviteId: string; notifyQueued: boolean }
  | { ok: false; message: string };

export async function createSpaceInviteAction(
  values: SpaceInviteCreateFormValues
): Promise<CreateSpaceInviteResult> {
  const parsed = spaceInviteCreateSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }

  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return { ok: false, message: 'Not authenticated.' };
  }

  const invitableRoles = await listInvitableSpaceRolesForUser(
    supabase,
    userData.user.id,
    parsed.data.spaceId
  );
  const allowedRoleKeys = new Set(invitableRoles.map((role) => role.key));
  if (!allowedRoleKeys.has(parsed.data.roleKey)) {
    return {
      ok: false,
      message: 'Selected role is not allowed for this Space.',
    };
  }

  const { data, error } = await supabase.rpc('rpc_create_space_invite', {
    p_space_id: parsed.data.spaceId,
    p_email: parsed.data.email,
    p_role_key: parsed.data.roleKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Could not create invite.',
    };
  }

  const inviteResult = parseInviteRpcResult(data);
  if (!inviteResult) {
    return { ok: false, message: 'Unexpected response from server.' };
  }
  const { inviteId, token } = inviteResult;

  revalidatePath('/organizations');
  revalidatePath('/profile');
  return { ok: true, inviteId, token, notifyQueued: true };
}

export type RevokeSpaceInviteResult =
  | { ok: true }
  | { ok: false; message: string };

export async function revokeSpaceInviteAction(
  inviteId: string
): Promise<RevokeSpaceInviteResult> {
  const trimmed = inviteId.trim();
  if (!trimmed) {
    return { ok: false, message: 'Invite id is required.' };
  }

  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return { ok: false, message: 'Not authenticated.' };
  }

  const { error } = await supabase.rpc('rpc_revoke_space_invite', {
    p_invite_id: trimmed,
  });

  if (error) {
    return {
      ok: false,
      message:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Could not revoke invite.',
    };
  }

  revalidatePath('/organizations');
  revalidatePath('/profile');
  return { ok: true };
}
