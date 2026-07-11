'use server';

import { entityIds } from '@workspace/entity-id';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  extractOwnedAvatarObjectPath,
  removeMediaObjects,
  toOptionalTrimmed,
} from '@/lib/media-avatar';
import { getIsOrgAdminForOrganization } from '@/lib/platform-org-admin';
import { getIsSuperAdminForUser } from '@/lib/platform-nav-roles';
import { getIsUserSpaceAdminForSpace } from '@/lib/platform-space-admin';
import { createClient } from '@/lib/supabase/server';

const spaceAvatarSchema = z
  .object({
    spaceId: z
      .string()
      .trim()
      .min(1, 'Space is required.')
      .refine((v) => v.startsWith(`${entityIds.space.prefix}_`), {
        message: 'Space is required.',
      })
      .transform((v) => entityIds.space.brand(v)),
    avatar_url: z
      .string()
      .trim()
      .max(2000, 'URL is too long.')
      .refine((value) => value.length === 0 || /^https?:\/\//.test(value), {
        message: 'Use a valid URL starting with http:// or https://',
      }),
  })
  .strict();

export type UpdateSpaceAvatarResult =
  { ok: true } | { ok: false; message: string };

export async function updateSpaceAvatarAction(
  values: z.input<typeof spaceAvatarSchema>
): Promise<UpdateSpaceAvatarResult> {
  const parsed = spaceAvatarSchema.safeParse(values);
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

  const { spaceId } = parsed.data;
  const { data: spaceRow, error: spaceError } = await supabase
    .from('spaces')
    .select('id,organization_id,avatar_url')
    .eq('id', spaceId)
    .maybeSingle();

  if (spaceError || !spaceRow) {
    return { ok: false, message: 'Space not found.' };
  }

  const [isSuperAdmin, isOrgAdmin, isSpaceAdmin] = await Promise.all([
    getIsSuperAdminForUser(supabase, userData.user.id),
    getIsOrgAdminForOrganization(
      supabase,
      userData.user.id,
      String(spaceRow.organization_id)
    ),
    getIsUserSpaceAdminForSpace(supabase, userData.user.id, spaceId),
  ]);

  if (!isSuperAdmin && !isOrgAdmin && !isSpaceAdmin) {
    return { ok: false, message: 'Not allowed to update this space.' };
  }

  const nextAvatarUrl = toOptionalTrimmed(parsed.data.avatar_url);
  const nextAvatarObjectPath =
    nextAvatarUrl === null
      ? null
      : extractOwnedAvatarObjectPath(nextAvatarUrl, 'spaces', spaceId);

  if (
    nextAvatarUrl !== null &&
    (nextAvatarObjectPath === null ||
      !nextAvatarObjectPath.includes('/avatar/'))
  ) {
    return {
      ok: false,
      message: 'Avatar must be an uploaded file from this space media folder.',
    };
  }

  const currentAvatarUrl =
    typeof spaceRow.avatar_url === 'string'
      ? spaceRow.avatar_url.trim() || null
      : null;
  const currentAvatarObjectPath =
    currentAvatarUrl === null
      ? null
      : extractOwnedAvatarObjectPath(currentAvatarUrl, 'spaces', spaceId);

  const { error: updateError } = await supabase
    .from('spaces')
    .update({ avatar_url: nextAvatarUrl })
    .eq('id', spaceId);

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
          : 'Could not save space avatar. Please try again.',
    };
  }

  if (currentAvatarObjectPath !== nextAvatarObjectPath) {
    await removeMediaObjects(supabase, [currentAvatarObjectPath]);
  }

  revalidatePath('/space-settings');
  return { ok: true };
}
