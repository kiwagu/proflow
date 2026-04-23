'use server';

import { z } from 'zod';
import {
  CRITICAL_CAPABILITY_KEYS,
  hasCriticalCapability,
} from '@workspace/rbac/critical-capability';

import { PLATFORM_OPERATOR_CONSOLE_PATH } from '@/lib/platform-routes';
import { revalidatePlatformPath } from '@/lib/platform-revalidate';
import { resolveAuthUserByEmail } from '@/lib/space-invite.auth-lookup.server';
import { createServiceRoleSupabaseClient } from '@/lib/supabase/service-role';
import { createClient } from '@/lib/supabase/server';

const grantPlatformSuperAdminSchema = z
  .object({
    email: z
      .string()
      .trim()
      .min(1, 'Email is required.')
      .max(254, 'Email must be at most 254 characters.')
      .email('Enter a valid email address.'),
    reason: z
      .string()
      .trim()
      .min(1, 'Reason is required.')
      .max(400, 'Reason must be at most 400 characters.'),
    confirmed: z
      .boolean()
      .refine((value) => value === true, 'Explicit confirmation is required.'),
  })
  .strict();

const revokePlatformSuperAdminSchema = z
  .object({
    userId: z.uuid('Invalid user id.'),
    reason: z
      .string()
      .trim()
      .min(1, 'Reason is required.')
      .max(400, 'Reason must be at most 400 characters.'),
    confirmed: z
      .boolean()
      .refine((value) => value === true, 'Explicit confirmation is required.'),
  })
  .strict();

export type GrantPlatformSuperAdminResult =
  | { ok: true; status: 'granted' | 'already_granted' }
  | { ok: false; message: string };

export type RevokePlatformSuperAdminResult =
  | { ok: true; status: 'revoked' | 'already_revoked' }
  | { ok: false; message: string };

type GrantPlatformSuperAdminStatus = Extract<
  GrantPlatformSuperAdminResult,
  { ok: true }
>['status'];

type RevokePlatformSuperAdminStatus = Extract<
  RevokePlatformSuperAdminResult,
  { ok: true }
>['status'];

function parseGrantPlatformSuperAdminStatus(
  value: unknown
): GrantPlatformSuperAdminStatus | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const status = Reflect.get(value, 'status');
  return status === 'granted' || status === 'already_granted' ? status : null;
}

function parseRevokePlatformSuperAdminStatus(
  value: unknown
): RevokePlatformSuperAdminStatus | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const status = Reflect.get(value, 'status');
  return status === 'revoked' || status === 'already_revoked' ? status : null;
}

function mapGrantPlatformSuperAdminError(message?: string): string {
  switch (message) {
    case 'Not allowed to grant platform super admin':
      return 'Not allowed to grant platform super admin.';
    case 'Target user not found':
      return 'User must already exist before granting platform super admin.';
    case 'No more than 3 active platform super admins allowed':
      return 'No more than 3 active platform super admins are allowed.';
    default:
      return process.env.NODE_ENV === 'development'
        ? (message ?? 'Could not grant platform super admin.')
        : 'Could not grant platform super admin.';
  }
}

function mapRevokePlatformSuperAdminError(message?: string): string {
  switch (message) {
    case 'Not allowed to revoke platform super admin':
      return 'Not allowed to revoke platform super admin.';
    case 'At least 1 active platform super admin is required':
      return 'At least 1 active platform super admin is required.';
    default:
      return process.env.NODE_ENV === 'development'
        ? (message ?? 'Could not revoke platform super admin.')
        : 'Could not revoke platform super admin.';
  }
}

export async function grantPlatformSuperAdminAction(
  values: z.input<typeof grantPlatformSuperAdminSchema>
): Promise<GrantPlatformSuperAdminResult> {
  const parsed = grantPlatformSuperAdminSchema.safeParse(values);
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

  const isSuperAdmin = await hasCriticalCapability(
    supabase,
    CRITICAL_CAPABILITY_KEYS.platformAdminOverride
  );
  if (!isSuperAdmin) {
    return {
      ok: false,
      message: 'Not allowed to grant platform super admin.',
    };
  }

  let targetUserId: string | null;
  try {
    const admin = createServiceRoleSupabaseClient();
    const authUser = await resolveAuthUserByEmail(admin, parsed.data.email);
    targetUserId = authUser?.id ?? null;
  } catch (error) {
    return {
      ok: false,
      message:
        process.env.NODE_ENV === 'development' && error instanceof Error
          ? error.message
          : 'Could not resolve the target user.',
    };
  }

  if (!targetUserId) {
    return {
      ok: false,
      message: 'User must already exist before granting platform super admin.',
    };
  }

  const { data, error } = await supabase.rpc('rpc_grant_platform_super_admin', {
    p_target_user_id: targetUserId,
    p_reason: parsed.data.reason.trim(),
  });

  const status = parseGrantPlatformSuperAdminStatus(data);
  if (error || !status) {
    return {
      ok: false,
      message: mapGrantPlatformSuperAdminError(error?.message),
    };
  }

  revalidatePlatformPath(PLATFORM_OPERATOR_CONSOLE_PATH);

  return { ok: true, status };
}

export async function revokePlatformSuperAdminAction(
  values: z.input<typeof revokePlatformSuperAdminSchema>
): Promise<RevokePlatformSuperAdminResult> {
  const parsed = revokePlatformSuperAdminSchema.safeParse(values);
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

  const isSuperAdmin = await hasCriticalCapability(
    supabase,
    CRITICAL_CAPABILITY_KEYS.platformAdminOverride
  );
  if (!isSuperAdmin) {
    return {
      ok: false,
      message: 'Not allowed to revoke platform super admin.',
    };
  }

  const { data, error } = await supabase.rpc(
    'rpc_revoke_platform_super_admin',
    {
      p_target_user_id: parsed.data.userId,
      p_reason: parsed.data.reason.trim(),
    }
  );

  const status = parseRevokePlatformSuperAdminStatus(data);
  if (error || !status) {
    return {
      ok: false,
      message: mapRevokePlatformSuperAdminError(error?.message),
    };
  }

  revalidatePlatformPath(PLATFORM_OPERATOR_CONSOLE_PATH);

  return { ok: true, status };
}
