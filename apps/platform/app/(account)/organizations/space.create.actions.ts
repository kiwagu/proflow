'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

import { setCanonicalActiveSpaceCookie } from '@workspace/gateway-auth/active-space.cookie';

import { createClient } from '@/lib/supabase/server';
import { getIsOrgAdminForOrganization } from '@/lib/platform-org-admin';
import {
  getServerSpaceSettingsTranslator,
  type SpaceSettingsLocale,
} from '@/app/(account)/space-settings/space-settings.i18n';

import {
  createSpaceCreateSchema,
  type SpaceCreateFormValues,
} from './space.create.schema';

export type SpaceCreateResult =
  | { ok: true; spaceId: string }
  | { ok: false; message: string };

export async function createSpaceAction(
  values: SpaceCreateFormValues,
  locale: SpaceSettingsLocale
): Promise<SpaceCreateResult> {
  const t = await getServerSpaceSettingsTranslator(locale);
  const parsed = createSpaceCreateSchema(t).safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ?? t('spaceCreate.errors.invalidInput'),
    };
  }

  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return { ok: false, message: t('spaceCreate.errors.notAuthenticated') };
  }

  const userId = userData.user.id;
  const orgId = parsed.data.organizationId;

  const isOrgAdmin = await getIsOrgAdminForOrganization(
    supabase,
    userId,
    orgId
  );
  if (!isOrgAdmin) {
    return {
      ok: false,
      message: t('spaceCreate.errors.notOrgAdmin'),
    };
  }

  const name = parsed.data.name.trim();
  const slug = parsed.data.slug.trim().toLowerCase();

  const { data: inserted, error: insertErr } = await supabase
    .from('spaces')
    .insert({
      organization_id: orgId,
      name,
      slug,
    })
    .select('id')
    .single();

  if (insertErr || !inserted?.id) {
    const message =
      process.env.NODE_ENV === 'development'
        ? (insertErr?.message ?? 'Insert failed.')
        : t('spaceCreate.errors.createFailed');
    return { ok: false, message };
  }

  const spaceId = inserted.id;

  const { error: smErr } = await supabase.from('space_memberships').insert({
    space_id: spaceId,
    user_id: userId,
    status: 'active',
  });

  if (smErr) {
    return {
      ok: false,
      message:
        process.env.NODE_ENV === 'development'
          ? smErr.message
          : t('spaceCreate.errors.membershipAssignFailed'),
    };
  }

  const { data: roleRow, error: roleErr } = await supabase
    .from('roles')
    .select('id')
    .eq('key', 'space_admin')
    .eq('role_kind', 'system')
    .is('owner_organization_id', null)
    .is('archived_at', null)
    .maybeSingle();

  if (roleErr || !roleRow?.id) {
    return {
      ok: false,
      message:
        process.env.NODE_ENV === 'development'
          ? (roleErr?.message ?? 'space_admin role missing')
          : t('spaceCreate.errors.roleBootstrapFailed'),
    };
  }

  const { error: roleAssignErr } = await supabase.from('user_role').insert({
    user_id: userId,
    space_id: spaceId,
    role_id: roleRow.id,
  });

  if (roleAssignErr) {
    return {
      ok: false,
      message:
        process.env.NODE_ENV === 'development'
          ? roleAssignErr.message
          : t('spaceCreate.errors.roleAssignmentFailed'),
    };
  }

  const store = await cookies();
  setCanonicalActiveSpaceCookie(store, spaceId);

  revalidatePath('/profile');
  revalidatePath('/organizations');
  return { ok: true, spaceId };
}
