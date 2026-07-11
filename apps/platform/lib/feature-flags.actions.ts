'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  CRITICAL_CAPABILITY_KEYS,
  hasCriticalCapability,
} from '@workspace/rbac/critical-capability';
import {
  isPlatformEntitlementRuntimeSettingKey,
  isPlatformFeatureFlagRuntimeSettingKey,
} from '@workspace/settings-runtime';

import { createClient } from '@/lib/supabase/server';

const featureFlagScopeSchema = z.enum(['global', 'organization', 'space']);

const featureFlagMutationSchema = z
  .object({
    scope: featureFlagScopeSchema,
    scopeId: z.string().trim().nullable().optional(),
    key: z.string().trim().min(1, 'Feature flag key is required.'),
    enabled: z.boolean(),
    revalidatePath: z
      .string()
      .trim()
      .regex(/^\/.+/, 'A platform path is required.'),
  })
  .strict();

export type MutatePlatformFeatureFlagResult =
  { ok: true } | { ok: false; message: string };

function mapFeatureFlagError(message?: string): string {
  if (!message) {
    return 'Could not save feature flag.';
  }

  if (message.startsWith('Not allowed') || message.startsWith('Invalid')) {
    return message;
  }

  if (message.includes('target not found')) {
    return message;
  }

  return process.env.NODE_ENV === 'development'
    ? message
    : 'Could not save feature flag.';
}

function resolveFeatureFlagScopeId(input: {
  scope: z.infer<typeof featureFlagScopeSchema>;
  scopeId?: string | null;
}): string | null {
  const scopeId = input.scopeId?.trim() || null;

  if (input.scope === 'global') {
    return null;
  }

  return scopeId;
}

export async function mutatePlatformFeatureFlagAction(
  values: z.input<typeof featureFlagMutationSchema>
): Promise<MutatePlatformFeatureFlagResult> {
  const parsed = featureFlagMutationSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }

  if (
    !isPlatformFeatureFlagRuntimeSettingKey(parsed.data.key) &&
    !isPlatformEntitlementRuntimeSettingKey(parsed.data.key)
  ) {
    return { ok: false, message: 'Unknown feature flag key.' };
  }

  const scopeId = resolveFeatureFlagScopeId(parsed.data);
  if (parsed.data.scope !== 'global' && !scopeId) {
    return {
      ok: false,
      message: 'Scope id is required for this feature flag.',
    };
  }

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { ok: false, message: 'Not authenticated.' };
  }

  if (parsed.data.scope === 'global') {
    const canManageGlobalFeatureFlags = await hasCriticalCapability(
      supabase,
      CRITICAL_CAPABILITY_KEYS.platformAdminOverride
    );

    if (!canManageGlobalFeatureFlags) {
      return {
        ok: false,
        message: 'Not allowed to manage global feature flags.',
      };
    }
  }

  const { error } = await supabase.rpc('rpc_set_platform_feature_flag', {
    p_scope: parsed.data.scope,
    p_scope_id: scopeId ?? undefined,
    p_key: parsed.data.key,
    p_enabled: parsed.data.enabled,
  });

  if (error) {
    return {
      ok: false,
      message: mapFeatureFlagError(error.message),
    };
  }

  revalidatePath(parsed.data.revalidatePath);
  return { ok: true };
}
