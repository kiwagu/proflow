'use server';

import { cookies } from 'next/headers';

import { setCanonicalActiveSpaceCookie } from '@workspace/gateway-auth/active-space.cookie';
import {
  CRITICAL_CAPABILITY_KEYS,
  hasCriticalCapability,
} from '@workspace/rbac/critical-capability';

import { PLATFORM_OPERATOR_CONSOLE_PATH } from '@/lib/platform-routes';
import { revalidatePlatformPath } from '@/lib/platform-revalidate';
import { createClient } from '@/lib/supabase/server';

export type SetActiveSpaceResult =
  | { ok: true }
  | { ok: false; message: string };

export async function setActiveSpaceAction(
  spaceId: string
): Promise<SetActiveSpaceResult> {
  const trimmed = spaceId.trim();
  if (!trimmed) {
    return { ok: false, message: 'Space is required.' };
  }

  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return { ok: false, message: 'Not authenticated.' };
  }

  const { data, error } = await supabase
    .from('space_memberships')
    .select('space_id')
    .eq('user_id', userData.user.id)
    .eq('space_id', trimmed)
    .eq('status', 'active')
    .maybeSingle();

  const isCriticalOverride = await hasCriticalCapability(
    supabase,
    CRITICAL_CAPABILITY_KEYS.platformAdminOverride
  );

  if (error || !data) {
    if (!isCriticalOverride) {
      return { ok: false, message: 'Not a member of this space.' };
    }

    const { data: targetSpace, error: targetSpaceErr } = await supabase
      .from('spaces')
      .select('id,organization_id')
      .eq('id', trimmed)
      .maybeSingle();

    if (targetSpaceErr || !targetSpace) {
      return { ok: false, message: 'Space not found.' };
    }

    const store = await cookies();
    const previousSpaceId = store.get('pf_active_space_id')?.value ?? null;
    setCanonicalActiveSpaceCookie(store, trimmed);

    const { error: auditErr } = await supabase
      .from('space_admin_audit_log')
      .insert({
        actor_user_id: userData.user.id,
        action: 'support.space_context.switch',
        entity_type: 'support_context',
        entity_id: trimmed,
        organization_id: targetSpace.organization_id,
        space_id: trimmed,
        request_id: null,
        previous_value: previousSpaceId
          ? { active_space_id: previousSpaceId }
          : null,
        new_value: { active_space_id: trimmed },
      });

    if (auditErr) {
      return {
        ok: false,
        message:
          process.env.NODE_ENV === 'development'
            ? auditErr.message
            : 'Could not switch support context.',
      };
    }

    revalidatePlatformPath('/');
    revalidatePlatformPath('/organizations');
    revalidatePlatformPath('/space-settings');
    revalidatePlatformPath(PLATFORM_OPERATOR_CONSOLE_PATH);
    return { ok: true };
  }

  const store = await cookies();
  setCanonicalActiveSpaceCookie(store, trimmed);

  revalidatePlatformPath('/');
  revalidatePlatformPath('/organizations');
  revalidatePlatformPath('/space-settings');
  return { ok: true };
}
