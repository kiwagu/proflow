'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { z } from 'zod';
import {
  CRITICAL_CAPABILITY_KEYS,
  hasCriticalCapability,
} from '@workspace/rbac/critical-capability';
import {
  PLATFORM_LOCALE_COOKIE,
  PLATFORM_LOCALES,
  RUNTIME_SETTING_KEYS,
  getRuntimeSettingDefinition,
  isPlatformLocale,
  isPlatformFeatureFlagRuntimeSettingKey,
  runtimeSettingScopeSchema,
  scopeAllowsRuntimeSetting,
  serializeRuntimeSettingInput,
} from '@workspace/settings-runtime';
import { createClient } from '@/lib/supabase/server';

const runtimeSettingMutationSchema = z
  .object({
    scope: runtimeSettingScopeSchema,
    scopeId: z.string().trim().nullable().optional(),
    key: z.string().trim().min(1, 'Setting key is required.'),
    rawValue: z.string().optional().default(''),
    mode: z.enum(['set', 'inherit']).default('set'),
    revalidatePath: z
      .string()
      .trim()
      .regex(/^\/.+/, 'A platform path is required.'),
  })
  .strict();

export type MutateRuntimeSettingResult =
  | { ok: true }
  | { ok: false; message: string };

function mapRuntimeSettingError(message?: string): string {
  if (!message) {
    return 'Could not save setting.';
  }

  if (message.startsWith('Not allowed') || message.startsWith('Invalid')) {
    return message;
  }

  if (message.includes('target not found')) {
    return message;
  }

  return process.env.NODE_ENV === 'development'
    ? message
    : 'Could not save setting.';
}

export async function mutateRuntimeSettingAction(
  values: z.input<typeof runtimeSettingMutationSchema>
): Promise<MutateRuntimeSettingResult> {
  const parsed = runtimeSettingMutationSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }

  const definition = getRuntimeSettingDefinition(parsed.data.key);
  if (!definition) {
    return { ok: false, message: 'Unknown runtime setting key.' };
  }

  if (isPlatformFeatureFlagRuntimeSettingKey(parsed.data.key)) {
    return {
      ok: false,
      message: 'Feature flags use a dedicated mutation path.',
    };
  }

  if (!scopeAllowsRuntimeSetting(parsed.data.key, parsed.data.scope)) {
    return {
      ok: false,
      message: 'This setting is not available for that scope.',
    };
  }

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { ok: false, message: 'Not authenticated.' };
  }

  const scopeId = parsed.data.scopeId?.trim() || null;

  if (parsed.data.scope === 'global') {
    const canManageGlobalRuntimeSettings = await hasCriticalCapability(
      supabase,
      CRITICAL_CAPABILITY_KEYS.platformAdminOverride
    );

    if (!canManageGlobalRuntimeSettings) {
      return {
        ok: false,
        message: 'Not allowed to manage global runtime settings.',
      };
    }
  }

  if (parsed.data.mode === 'inherit') {
    const { error } = await supabase.rpc('rpc_delete_runtime_setting', {
      p_scope: parsed.data.scope,
      p_scope_id: scopeId ?? undefined,
      p_key: parsed.data.key,
    });

    if (error) {
      return {
        ok: false,
        message: mapRuntimeSettingError(error.message),
      };
    }

    if (
      parsed.data.key === RUNTIME_SETTING_KEYS.platformLocale &&
      parsed.data.scope === 'user'
    ) {
      const cookieStore = await cookies();
      cookieStore.delete(PLATFORM_LOCALE_COOKIE);
    }

    revalidatePath(parsed.data.revalidatePath);
    return { ok: true };
  }

  if (parsed.data.key === RUNTIME_SETTING_KEYS.platformLocale) {
    const normalizedLocale = parsed.data.rawValue.trim().toLowerCase();

    if (!isPlatformLocale(normalizedLocale)) {
      return {
        ok: false,
        message: `Invalid locale. Supported locales: ${PLATFORM_LOCALES.join(', ')}.`,
      };
    }
  }

  let serializedValue;
  try {
    serializedValue = serializeRuntimeSettingInput(
      parsed.data.key,
      parsed.data.rawValue
    );
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : 'Invalid runtime setting value.',
    };
  }

  const { error } = await supabase.rpc('rpc_set_runtime_setting', {
    p_scope: parsed.data.scope,
    p_scope_id: scopeId ?? undefined,
    p_key: parsed.data.key,
    p_value: serializedValue.value,
    p_value_type: serializedValue.valueType,
    p_is_public: definition.isPublic,
  });

  if (error) {
    return {
      ok: false,
      message: mapRuntimeSettingError(error.message),
    };
  }

  if (
    parsed.data.key === RUNTIME_SETTING_KEYS.platformLocale &&
    parsed.data.scope === 'user'
  ) {
    const cookieStore = await cookies();
    cookieStore.set(PLATFORM_LOCALE_COOKIE, parsed.data.rawValue.trim(), {
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  revalidatePath(parsed.data.revalidatePath);
  return { ok: true };
}
