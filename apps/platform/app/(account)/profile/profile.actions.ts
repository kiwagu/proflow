'use server';

import { revalidatePath } from 'next/cache';

import {
  extractOwnedAvatarObjectPath,
  removeMediaObjects,
  toOptionalTrimmed,
} from '@/lib/media-avatar';
import { createClient } from '@/lib/supabase/server';

import { profileSchema, type ProfileFormValues } from './profile.schema';

export type UpdateProfileResult = { ok: true } | { ok: false; message: string };

export async function updateProfileAction(
  values: ProfileFormValues
): Promise<UpdateProfileResult> {
  const parsed = profileSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid profile data.',
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) {
    return { ok: false, message: 'Not authenticated.' };
  }

  const userId = data.claims.sub;
  const nextAvatarUrl = toOptionalTrimmed(parsed.data.avatar_url);
  const nextAvatarObjectPath =
    nextAvatarUrl === null
      ? null
      : extractOwnedAvatarObjectPath(nextAvatarUrl, 'avatars', userId);

  if (nextAvatarUrl !== null && nextAvatarObjectPath === null) {
    return {
      ok: false,
      message: 'Avatar must be an uploaded file from your own media folder.',
    };
  }

  const { data: existingProfile, error: existingProfileError } = await supabase
    .from('profiles')
    .select('avatar_url')
    .eq('user_id', userId)
    .maybeSingle();

  if (existingProfileError) {
    const message =
      process.env.NODE_ENV === 'development'
        ? existingProfileError.message
        : 'Could not load the current profile. Please try again.';
    return { ok: false, message };
  }

  const currentAvatarUrl =
    typeof existingProfile?.avatar_url === 'string'
      ? existingProfile.avatar_url.trim() || null
      : null;
  const currentAvatarObjectPath =
    currentAvatarUrl === null
      ? null
      : extractOwnedAvatarObjectPath(currentAvatarUrl, 'avatars', userId);

  const { error: upsertError } = await supabase.from('profiles').upsert(
    {
      user_id: userId,
      email: toOptionalTrimmed(parsed.data.email),
      display_name: toOptionalTrimmed(parsed.data.display_name),
      avatar_url: nextAvatarUrl,
      bio: toOptionalTrimmed(parsed.data.bio),
    },
    { onConflict: 'user_id' }
  );

  if (upsertError) {
    if (
      nextAvatarObjectPath !== null &&
      nextAvatarObjectPath !== currentAvatarObjectPath
    ) {
      await removeMediaObjects(supabase, [nextAvatarObjectPath]);
    }

    const message =
      process.env.NODE_ENV === 'development'
        ? upsertError.message
        : 'Could not save profile. Please try again.';
    return { ok: false, message };
  }

  if (currentAvatarObjectPath !== nextAvatarObjectPath) {
    await removeMediaObjects(supabase, [currentAvatarObjectPath]);
  }

  revalidatePath('/profile');
  return { ok: true };
}
