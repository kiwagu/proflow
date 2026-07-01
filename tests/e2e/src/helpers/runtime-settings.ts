import type { Database } from '@workspace/db';
import { createClient } from '@supabase/supabase-js';
import { RUNTIME_SETTING_KEYS } from '@workspace/settings-runtime';

import { resolveServiceRoleKey, resolveSupabaseUrl } from './test-user.js';

const PLATFORM_LOCALE_KEY = 'platform.locale';
const PLATFORM_FEATURE_FLAG_ORGANIZATION_SETTINGS_KEY =
  'platform.feature_flag.organization_settings';
const MEDIA_MAX_UPLOAD_BYTES_KEY = RUNTIME_SETTING_KEYS.mediaMaxUploadBytes;

function serviceSupabase() {
  return createClient<Database>(resolveSupabaseUrl(), resolveServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function upsertGlobalRuntimeSetting(input: {
  key: string;
  value: Database['public']['Tables']['runtime_settings']['Insert']['value'];
  valueType: Database['public']['Tables']['runtime_settings']['Insert']['value_type'];
  isPublic: boolean;
}): Promise<void> {
  const supabase = serviceSupabase();
  const { error } = await supabase.from('runtime_settings').upsert(
    {
      scope: 'global',
      scope_id: null,
      key: input.key,
      value: input.value,
      value_type: input.valueType,
      is_public: input.isPublic,
    },
    {
      onConflict: 'scope,key,scope_target',
    }
  );

  if (error) {
    throw new Error(
      `runtime-settings helper: failed to upsert ${input.key}: ${error.message}`
    );
  }
}

async function deleteGlobalRuntimeSetting(key: string): Promise<void> {
  const supabase = serviceSupabase();
  const { error } = await supabase
    .from('runtime_settings')
    .delete()
    .eq('scope', 'global')
    .is('scope_id', null)
    .eq('key', key);

  if (error) {
    throw new Error(
      `runtime-settings helper: failed to delete ${key}: ${error.message}`
    );
  }
}

export async function setGlobalPlatformLocale(
  locale: 'en' | 'es'
): Promise<void> {
  await upsertGlobalRuntimeSetting({
    key: PLATFORM_LOCALE_KEY,
    value: locale,
    valueType: 'string',
    isPublic: true,
  });
}

export async function resetGlobalPlatformLocale(): Promise<void> {
  await deleteGlobalRuntimeSetting(PLATFORM_LOCALE_KEY);
}

export async function setGlobalOrganizationSettingsFeatureFlag(
  enabled: boolean
): Promise<void> {
  await upsertGlobalRuntimeSetting({
    key: PLATFORM_FEATURE_FLAG_ORGANIZATION_SETTINGS_KEY,
    value: enabled,
    valueType: 'boolean',
    isPublic: false,
  });
}

export async function resetGlobalOrganizationSettingsFeatureFlag(): Promise<void> {
  await deleteGlobalRuntimeSetting(
    PLATFORM_FEATURE_FLAG_ORGANIZATION_SETTINGS_KEY
  );
}

/** Upsert an ORGANIZATION-scoped runtime setting row (service-role) — the org-scope
 * sibling of `upsertGlobalRuntimeSetting`, targeting the same `scope,key,scope_target`
 * conflict key with `scope='organization'` + a concrete `scope_id`. */
async function upsertOrganizationRuntimeSetting(input: {
  organizationId: string;
  key: string;
  value: Database['public']['Tables']['runtime_settings']['Insert']['value'];
  valueType: Database['public']['Tables']['runtime_settings']['Insert']['value_type'];
  isPublic: boolean;
}): Promise<void> {
  const supabase = serviceSupabase();
  const { error } = await supabase.from('runtime_settings').upsert(
    {
      scope: 'organization',
      scope_id: input.organizationId,
      key: input.key,
      value: input.value,
      value_type: input.valueType,
      is_public: input.isPublic,
    },
    {
      onConflict: 'scope,key,scope_target',
    }
  );

  if (error) {
    throw new Error(
      `runtime-settings helper: failed to upsert org ${input.key}: ${error.message}`
    );
  }
}

async function deleteOrganizationRuntimeSetting(
  organizationId: string,
  key: string
): Promise<void> {
  const supabase = serviceSupabase();
  const { error } = await supabase
    .from('runtime_settings')
    .delete()
    .eq('scope', 'organization')
    .eq('scope_id', organizationId)
    .eq('key', key);

  if (error) {
    throw new Error(
      `runtime-settings helper: failed to delete org ${key}: ${error.message}`
    );
  }
}

/** Set the ORG-scoped `platform.media.max_upload_bytes` governance dial (ADR-0026 §A4)
 * — the resolver reads org → global → default, so an org row LOWERS the effective soft
 * limit for uploads targeting a space in that org. Public row (an uploader must read it).
 * Pair with `resetOrganizationMediaMaxUploadBytes` to fall back to the 200 MB default. */
export async function setOrganizationMediaMaxUploadBytes(
  organizationId: string,
  bytes: number
): Promise<void> {
  await upsertOrganizationRuntimeSetting({
    organizationId,
    key: MEDIA_MAX_UPLOAD_BYTES_KEY,
    value: bytes,
    valueType: 'number',
    isPublic: true,
  });
}

export async function resetOrganizationMediaMaxUploadBytes(
  organizationId: string
): Promise<void> {
  await deleteOrganizationRuntimeSetting(
    organizationId,
    MEDIA_MAX_UPLOAD_BYTES_KEY
  );
}
