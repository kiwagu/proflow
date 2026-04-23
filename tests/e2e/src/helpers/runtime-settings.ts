import type { Database } from '@workspace/db';
import { createClient } from '@supabase/supabase-js';

import { resolveServiceRoleKey, resolveSupabaseUrl } from './test-user.js';

const PLATFORM_LOCALE_KEY = 'platform.locale';
const PLATFORM_FEATURE_FLAG_ORGANIZATION_SETTINGS_KEY =
  'platform.feature_flag.organization_settings';

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
