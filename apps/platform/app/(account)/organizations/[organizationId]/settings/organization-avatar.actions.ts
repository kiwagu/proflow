'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  extractOwnedAvatarObjectPath,
  removeMediaObjects,
  toOptionalTrimmed,
} from '@/lib/media-avatar';
import { getIsOrgAdminForOrganization } from '@/lib/platform-org-admin';
import { getIsSuperAdminForUser } from '@/lib/platform-nav-roles';
import { createClient } from '@/lib/supabase/server';

const organizationAvatarSchema = z
  .object({
    organizationId: z.string().trim().min(1, 'Organization is required.'),
    avatar_url: z
      .string()
      .trim()
      .max(2000, 'URL is too long.')
      .refine((value) => value.length === 0 || /^https?:\/\//.test(value), {
        message: 'Use a valid URL starting with http:// or https://',
      }),
  })
  .strict();

export type UpdateOrganizationAvatarResult =
  | { ok: true }
  | { ok: false; message: string };

export async function updateOrganizationAvatarAction(
  values: z.input<typeof organizationAvatarSchema>
): Promise<UpdateOrganizationAvatarResult> {
  const parsed = organizationAvatarSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid avatar data.',
    };
  }

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { ok: false, message: 'Not authenticated.' };
  }

  const { organizationId } = parsed.data;
  const [organizationRow, isSuperAdmin, isOrgAdmin] = await Promise.all([
    supabase
      .from('organizations')
      .select('id,avatar_url')
      .eq('id', organizationId)
      .maybeSingle(),
    getIsSuperAdminForUser(supabase, userData.user.id),
    getIsOrgAdminForOrganization(supabase, userData.user.id, organizationId),
  ]);

  if (!organizationRow.data) {
    return { ok: false, message: 'Organization not found.' };
  }

  if (!isSuperAdmin && !isOrgAdmin) {
    return { ok: false, message: 'Not allowed to update this organization.' };
  }

  const nextAvatarUrl = toOptionalTrimmed(parsed.data.avatar_url);
  const nextAvatarObjectPath =
    nextAvatarUrl === null
      ? null
      : extractOwnedAvatarObjectPath(
          nextAvatarUrl,
          'organizations',
          organizationId
        );

  if (nextAvatarUrl !== null && nextAvatarObjectPath === null) {
    return {
      ok: false,
      message:
        'Avatar must be an uploaded file from this organization media folder.',
    };
  }

  const currentAvatarUrl =
    typeof organizationRow.data.avatar_url === 'string'
      ? organizationRow.data.avatar_url.trim() || null
      : null;
  const currentAvatarObjectPath =
    currentAvatarUrl === null
      ? null
      : extractOwnedAvatarObjectPath(
          currentAvatarUrl,
          'organizations',
          organizationId
        );

  const { error: updateError } = await supabase
    .from('organizations')
    .update({ avatar_url: nextAvatarUrl })
    .eq('id', organizationId);

  if (updateError) {
    if (
      nextAvatarObjectPath !== null &&
      nextAvatarObjectPath !== currentAvatarObjectPath
    ) {
      await removeMediaObjects(supabase, [nextAvatarObjectPath]);
    }

    return {
      ok: false,
      message:
        process.env.NODE_ENV === 'development'
          ? updateError.message
          : 'Could not save organization avatar. Please try again.',
    };
  }

  if (currentAvatarObjectPath !== nextAvatarObjectPath) {
    await removeMediaObjects(supabase, [currentAvatarObjectPath]);
  }

  revalidatePath(`/organizations/${organizationId}/settings`);
  return { ok: true };
}
