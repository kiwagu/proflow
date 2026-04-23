import type { Database } from '@workspace/db';
import { resolveLogLevel, setLogLevel } from '@workspace/logger';
import {
  defaultPlatformLocale,
  defaultPlatformFeatureFlags,
  type JsonValue,
  getDefaultRuntimeSettingValue,
  getPlatformFeatureFlagRuntimeSettingKey,
  isPlatformLocale,
  resolvePlatformLocaleWithPriority,
  parseRuntimeSettingValue,
  PLATFORM_FEATURE_FLAG_KEYS,
  type PlatformFeatureFlagKey,
  RUNTIME_SETTING_KEYS,
  type RuntimeSettingKey,
  type RuntimeSettingScope,
} from '@workspace/settings-runtime';
import type { SupabaseClient } from '@supabase/supabase-js';

import { type SpaceSettingsLocale } from '@/app/(account)/space-settings/space-settings.i18n';
import { createServiceRoleSupabaseClient } from '@/lib/supabase/service-role';

type RuntimeSettingsRow =
  Database['public']['Tables']['runtime_settings']['Row'];

function buildScopedSettingsQuery(
  supabase: SupabaseClient<Database>,
  scope: RuntimeSettingScope,
  scopeId: string | null,
  keys: readonly string[]
) {
  let query = supabase
    .from('runtime_settings')
    .select('key,value,value_type,is_public,scope,scope_id,updated_at')
    .eq('scope', scope)
    .in('key', [...keys]);

  if (scopeId) {
    query = query.eq('scope_id', scopeId);
  } else {
    query = query.is('scope_id', null);
  }

  return query;
}

export async function listScopedRuntimeSettings(
  supabase: SupabaseClient<Database>,
  scope: RuntimeSettingScope,
  scopeId: string | null,
  keys: readonly string[]
): Promise<Map<string, JsonValue>> {
  if (keys.length === 0) {
    return new Map();
  }

  const { data, error } = await buildScopedSettingsQuery(
    supabase,
    scope,
    scopeId,
    keys
  );

  if (error || !data) {
    return new Map();
  }

  const resolved = new Map<string, JsonValue>();
  for (const row of data as RuntimeSettingsRow[]) {
    try {
      resolved.set(row.key, parseRuntimeSettingValue(row.key, row.value));
    } catch (parseError) {
      if (
        process.env.NODE_ENV === 'development' &&
        parseError instanceof Error
      ) {
        console.error(
          '[runtime-settings] parse failed:',
          row.key,
          parseError.message
        );
      }
    }
  }

  return resolved;
}

export async function getScopedRuntimeSettingValue(
  supabase: SupabaseClient<Database>,
  scope: RuntimeSettingScope,
  scopeId: string | null,
  key: RuntimeSettingKey
): Promise<JsonValue | null> {
  const rows = await listScopedRuntimeSettings(supabase, scope, scopeId, [key]);
  return rows.get(key) ?? null;
}

function readStoredPlatformLocale(
  value: JsonValue | null,
  source: string
): SpaceSettingsLocale | null {
  if (value === null) {
    return null;
  }

  if (isPlatformLocale(value)) {
    return value;
  }

  throw new Error(
    `Unsupported platform.locale value in ${source}: ${JSON.stringify(value)}`
  );
}

export function resolveScopedPlatformLocaleValue(
  value: JsonValue | null,
  params?: {
    allowInherit?: boolean;
    source?: string;
  }
): SpaceSettingsLocale | '' {
  const locale = readStoredPlatformLocale(
    value,
    params?.source ?? 'runtime_settings'
  );

  if (locale !== null) {
    return locale;
  }

  if (params?.allowInherit) {
    return '';
  }

  return readStoredPlatformLocale(
    getDefaultRuntimeSettingValue(RUNTIME_SETTING_KEYS.platformLocale),
    'runtime setting default'
  ) as SpaceSettingsLocale;
}

async function resolveOrganizationIdForSpace(
  supabase: SupabaseClient<Database>,
  spaceId: string | null
): Promise<string | null> {
  if (!spaceId) {
    return null;
  }

  const { data } = await supabase
    .from('spaces')
    .select('organization_id')
    .eq('id', spaceId)
    .maybeSingle();

  return data?.organization_id ?? null;
}

export async function resolvePlatformLocaleForSession(
  supabase: SupabaseClient<Database>,
  params: {
    acceptLanguage: string | null | undefined;
    localeCookie?: string | null;
    userId: string | null;
    activeSpaceId?: string | null;
    organizationId?: string | null;
  }
): Promise<SpaceSettingsLocale> {
  const organizationId =
    params.organizationId ??
    (await resolveOrganizationIdForSpace(
      supabase,
      params.activeSpaceId ?? null
    ));

  const [userLocale, spaceLocale, organizationLocale, globalLocale] =
    await Promise.all([
      params.userId
        ? getScopedRuntimeSettingValue(
            supabase,
            'user',
            params.userId,
            RUNTIME_SETTING_KEYS.platformLocale
          )
        : Promise.resolve(null),
      params.activeSpaceId
        ? getScopedRuntimeSettingValue(
            supabase,
            'space',
            params.activeSpaceId,
            RUNTIME_SETTING_KEYS.platformLocale
          )
        : Promise.resolve(null),
      organizationId
        ? getScopedRuntimeSettingValue(
            supabase,
            'organization',
            organizationId,
            RUNTIME_SETTING_KEYS.platformLocale
          )
        : Promise.resolve(null),
      getScopedRuntimeSettingValue(
        supabase,
        'global',
        null,
        RUNTIME_SETTING_KEYS.platformLocale
      ),
    ]);

  const candidate = [
    readStoredPlatformLocale(userLocale, 'user scope'),
    readStoredPlatformLocale(spaceLocale, 'space scope'),
    readStoredPlatformLocale(organizationLocale, 'organization scope'),
    readStoredPlatformLocale(globalLocale, 'global scope'),
  ];

  return resolvePlatformLocaleWithPriority({
    userLocale: candidate[0],
    cookieLocale: params.localeCookie,
    spaceLocale: candidate[1],
    organizationLocale: candidate[2],
    globalLocale: candidate[3] ?? defaultPlatformLocale,
    acceptLanguage: params.acceptLanguage,
  });
}

export function getDefaultScopedRuntimeSettingValue(
  key: RuntimeSettingKey
): JsonValue {
  return getDefaultRuntimeSettingValue(key);
}

export type PlatformFeatureFlagResolutionSource =
  | 'global_default'
  | 'organization'
  | 'organization_disabled'
  | 'space_enabled'
  | 'space_disabled';

export type PlatformFeatureFlagResolution = {
  effectiveValue: boolean;
  globalDefaultValue: boolean;
  organizationValue: boolean | null;
  spaceValue: boolean | null;
  source: PlatformFeatureFlagResolutionSource;
};

function readBooleanRuntimeSetting(
  value: JsonValue | null | undefined,
  fallback: boolean
): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readStoredBooleanRuntimeSetting(
  value: JsonValue | undefined
): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export async function applyPlatformRuntimeLogLevel(): Promise<void> {
  const admin = createServiceRoleSupabaseClient();
  const value = await getScopedRuntimeSettingValue(
    admin,
    'global',
    null,
    RUNTIME_SETTING_KEYS.runtimeLogLevel
  );

  if (typeof value === 'string') {
    setLogLevel(value);
    return;
  }

  setLogLevel(resolveLogLevel());
}

export async function resolvePlatformFeatureFlagsForSession(params: {
  userId: string | null;
  activeSpaceId?: string | null;
  organizationId?: string | null;
}): Promise<Record<string, boolean>> {
  const states = await resolvePlatformFeatureFlagResolutionsForSession(params);

  const resolved: Record<string, boolean> = {};
  for (const [flagKey, state] of Object.entries(states)) {
    resolved[flagKey] = state.effectiveValue;
  }

  return {
    ...defaultPlatformFeatureFlags,
    ...resolved,
  };
}

export async function resolvePlatformFeatureFlagResolutionsForSession(params: {
  userId: string | null;
  activeSpaceId?: string | null;
  organizationId?: string | null;
}): Promise<Record<PlatformFeatureFlagKey, PlatformFeatureFlagResolution>> {
  const admin = createServiceRoleSupabaseClient();
  const organizationId =
    params.organizationId ??
    (await resolveOrganizationIdForSpace(admin, params.activeSpaceId ?? null));

  const featureFlagKeys = Object.values(
    PLATFORM_FEATURE_FLAG_KEYS
  ) as PlatformFeatureFlagKey[];
  const featureFlagRuntimeSettingKeys = featureFlagKeys.map(
    getPlatformFeatureFlagRuntimeSettingKey
  );

  const [globalFlags, organizationFlags, spaceFlags] = await Promise.all([
    listScopedRuntimeSettings(
      admin,
      'global',
      null,
      featureFlagRuntimeSettingKeys
    ),
    organizationId
      ? listScopedRuntimeSettings(
          admin,
          'organization',
          organizationId,
          featureFlagRuntimeSettingKeys
        )
      : Promise.resolve(new Map<string, JsonValue>()),
    params.activeSpaceId
      ? listScopedRuntimeSettings(
          admin,
          'space',
          params.activeSpaceId,
          featureFlagRuntimeSettingKeys
        )
      : Promise.resolve(new Map<string, JsonValue>()),
  ]);

  const resolved = {} as Record<
    PlatformFeatureFlagKey,
    PlatformFeatureFlagResolution
  >;

  for (const flagKey of featureFlagKeys) {
    const runtimeSettingKey = getPlatformFeatureFlagRuntimeSettingKey(flagKey);

    const platformDefault = readBooleanRuntimeSetting(
      globalFlags.get(runtimeSettingKey),
      defaultPlatformFeatureFlags[flagKey]
    );

    if (!organizationId) {
      resolved[flagKey] = {
        effectiveValue: platformDefault,
        globalDefaultValue: platformDefault,
        organizationValue: null,
        spaceValue: null,
        source: 'global_default',
      };
      continue;
    }

    const storedOrganizationValue = readStoredBooleanRuntimeSetting(
      organizationFlags.get(runtimeSettingKey)
    );
    const organizationEnabled = readBooleanRuntimeSetting(
      organizationFlags.get(runtimeSettingKey),
      defaultPlatformFeatureFlags[flagKey]
    );

    if (!params.activeSpaceId) {
      resolved[flagKey] = {
        effectiveValue: organizationEnabled,
        globalDefaultValue: platformDefault,
        organizationValue: organizationEnabled,
        spaceValue: null,
        source: 'organization',
      };
      continue;
    }

    const storedSpaceValue = readStoredBooleanRuntimeSetting(
      spaceFlags.get(runtimeSettingKey)
    );
    const spaceEnabled = readBooleanRuntimeSetting(
      spaceFlags.get(runtimeSettingKey),
      false
    );

    resolved[flagKey] = {
      effectiveValue: organizationEnabled && spaceEnabled,
      globalDefaultValue: platformDefault,
      organizationValue: storedOrganizationValue ?? organizationEnabled,
      spaceValue: storedSpaceValue ?? spaceEnabled,
      source: !organizationEnabled
        ? 'organization_disabled'
        : spaceEnabled
          ? 'space_enabled'
          : 'space_disabled',
    };
  }

  return resolved;
}

export async function isPlatformFeatureEnabledForSession(params: {
  flag: string;
  userId: string | null;
  activeSpaceId?: string | null;
  organizationId?: string | null;
}): Promise<boolean> {
  const flags = await resolvePlatformFeatureFlagsForSession(params);
  return flags[params.flag] ?? false;
}

export { PLATFORM_FEATURE_FLAG_KEYS };
