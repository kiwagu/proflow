import { z } from 'zod';

export const runtimeSettingScopeSchema = z.enum([
  'global',
  'organization',
  'space',
  'user',
]);

export type RuntimeSettingScope = z.infer<typeof runtimeSettingScopeSchema>;

export const runtimeSettingValueTypeSchema = z.enum([
  'string',
  'boolean',
  'number',
  'json',
]);

export type RuntimeSettingValueType = z.infer<
  typeof runtimeSettingValueTypeSchema
>;

export type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

export const PLATFORM_LOCALES = ['en', 'es'] as const;

export type PlatformLocale = (typeof PLATFORM_LOCALES)[number];

export const defaultPlatformLocale: PlatformLocale = 'en';
export const PLATFORM_LOCALE_COOKIE = 'pf_locale';
export const PLATFORM_LOCALE_URL_STRATEGY = 'basepath' as const;

export type PlatformLocaleUrlStrategy = typeof PLATFORM_LOCALE_URL_STRATEGY;

const platformLocaleValues = [...PLATFORM_LOCALES] as readonly string[];

export function isPlatformLocale(value: unknown): value is PlatformLocale {
  return (
    typeof value === 'string' &&
    platformLocaleValues.includes(value.toLowerCase())
  );
}

export function normalizePlatformLocale(
  locale: string | null | undefined
): PlatformLocale {
  if (!locale) {
    return defaultPlatformLocale;
  }

  const candidate = locale.toLowerCase().trim();
  if (isPlatformLocale(candidate)) {
    return candidate;
  }

  const base = candidate.split('-')[0] ?? '';
  if (isPlatformLocale(base)) {
    return base;
  }

  return defaultPlatformLocale;
}

export function parsePlatformLocale(
  locale: string | null | undefined
): PlatformLocale | null {
  if (!locale) {
    return null;
  }

  const candidate = locale.toLowerCase().trim();
  if (isPlatformLocale(candidate)) {
    return candidate;
  }

  const base = candidate.split('-')[0] ?? '';
  if (isPlatformLocale(base)) {
    return base;
  }

  return null;
}

export function resolvePlatformLocaleWithPriority(params: {
  userLocale?: unknown;
  cookieLocale?: string | null | undefined;
  spaceLocale?: unknown;
  organizationLocale?: unknown;
  globalLocale?: unknown;
  acceptLanguage?: string | null | undefined;
}): PlatformLocale {
  const candidates = [
    typeof params.userLocale === 'string'
      ? parsePlatformLocale(params.userLocale)
      : null,
    parsePlatformLocale(params.cookieLocale),
    typeof params.spaceLocale === 'string'
      ? parsePlatformLocale(params.spaceLocale)
      : null,
    typeof params.organizationLocale === 'string'
      ? parsePlatformLocale(params.organizationLocale)
      : null,
    typeof params.globalLocale === 'string'
      ? parsePlatformLocale(params.globalLocale)
      : null,
  ];

  for (const candidate of candidates) {
    if (candidate) {
      return candidate;
    }
  }

  return resolvePlatformLocaleFromAcceptLanguage(params.acceptLanguage);
}

export function resolvePlatformLocaleFromAcceptLanguage(
  acceptLanguage: string | null | undefined
): PlatformLocale {
  if (!acceptLanguage) {
    return defaultPlatformLocale;
  }

  const candidates = acceptLanguage
    .toLowerCase()
    .split(',')
    .map((part) => part.split(';')[0]?.trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (isPlatformLocale(candidate)) {
      return candidate;
    }

    const base = candidate.split('-')[0] ?? '';
    if (isPlatformLocale(base)) {
      return base;
    }
  }

  return defaultPlatformLocale;
}

type RuntimeSettingDefinition<TValue extends JsonValue> = Readonly<{
  key: string;
  valueType: RuntimeSettingValueType;
  allowedScopes: readonly RuntimeSettingScope[];
  isPublic: boolean;
  defaultValue: TValue;
  schema: z.ZodType<TValue>;
}>;

const platformLocaleSchema = z.enum(PLATFORM_LOCALES);
const runtimeLogLevelSchema = z.enum([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
]);
const platformFeatureFlagBooleanSchema = z.boolean();

export const PLATFORM_FEATURE_FLAG_KEYS = {
  organizationSettings: 'organization_settings',
} as const;

export type PlatformFeatureFlagKey =
  (typeof PLATFORM_FEATURE_FLAG_KEYS)[keyof typeof PLATFORM_FEATURE_FLAG_KEYS];

export const PLATFORM_FEATURE_FLAG_SETTING_KEYS = {
  [PLATFORM_FEATURE_FLAG_KEYS.organizationSettings]:
    'platform.feature_flag.organization_settings',
} as const;

export type PlatformFeatureFlagRuntimeSettingKey =
  (typeof PLATFORM_FEATURE_FLAG_SETTING_KEYS)[PlatformFeatureFlagKey];

const platformFeatureFlagRuntimeSettingKeyValues = Object.values(
  PLATFORM_FEATURE_FLAG_SETTING_KEYS
) as PlatformFeatureFlagRuntimeSettingKey[];

export const defaultPlatformFeatureFlags: Record<
  PlatformFeatureFlagKey,
  boolean
> = {
  [PLATFORM_FEATURE_FLAG_KEYS.organizationSettings]: false,
};

export function getPlatformFeatureFlagRuntimeSettingKey(
  key: PlatformFeatureFlagKey
): PlatformFeatureFlagRuntimeSettingKey {
  return PLATFORM_FEATURE_FLAG_SETTING_KEYS[key];
}

export function isPlatformFeatureFlagRuntimeSettingKey(
  key: string
): key is PlatformFeatureFlagRuntimeSettingKey {
  return platformFeatureFlagRuntimeSettingKeyValues.includes(
    key as PlatformFeatureFlagRuntimeSettingKey
  );
}

export const RUNTIME_SETTING_KEYS = {
  platformLocale: 'platform.locale',
  runtimeLogLevel: 'runtime.log_level',
  platformFeatureFlagOrganizationSettings:
    PLATFORM_FEATURE_FLAG_SETTING_KEYS[
      PLATFORM_FEATURE_FLAG_KEYS.organizationSettings
    ],
} as const;

export type RuntimeSettingKey =
  (typeof RUNTIME_SETTING_KEYS)[keyof typeof RUNTIME_SETTING_KEYS];

const runtimeSettingDefinitions: Record<
  RuntimeSettingKey,
  RuntimeSettingDefinition<JsonValue>
> = {
  [RUNTIME_SETTING_KEYS.platformLocale]: {
    key: RUNTIME_SETTING_KEYS.platformLocale,
    valueType: 'string',
    allowedScopes: ['global', 'organization', 'space', 'user'],
    isPublic: true,
    defaultValue: defaultPlatformLocale,
    schema: platformLocaleSchema,
  },
  [RUNTIME_SETTING_KEYS.runtimeLogLevel]: {
    key: RUNTIME_SETTING_KEYS.runtimeLogLevel,
    valueType: 'string',
    allowedScopes: ['global'],
    isPublic: false,
    defaultValue: 'info',
    schema: runtimeLogLevelSchema,
  },
  [RUNTIME_SETTING_KEYS.platformFeatureFlagOrganizationSettings]: {
    key: RUNTIME_SETTING_KEYS.platformFeatureFlagOrganizationSettings,
    valueType: 'boolean',
    allowedScopes: ['global', 'organization', 'space'],
    isPublic: false,
    defaultValue:
      defaultPlatformFeatureFlags[
        PLATFORM_FEATURE_FLAG_KEYS.organizationSettings
      ],
    schema: platformFeatureFlagBooleanSchema,
  },
};

export function getRuntimeSettingDefinition(
  key: string
): RuntimeSettingDefinition<JsonValue> | null {
  return runtimeSettingDefinitions[key as RuntimeSettingKey] ?? null;
}

export function isRuntimeSettingKey(key: string): key is RuntimeSettingKey {
  return getRuntimeSettingDefinition(key) !== null;
}

export function scopeAllowsRuntimeSetting(
  key: string,
  scope: RuntimeSettingScope
): boolean {
  const definition = getRuntimeSettingDefinition(key);
  return definition?.allowedScopes.includes(scope) ?? false;
}

export function getDefaultRuntimeSettingValue(
  key: RuntimeSettingKey
): JsonValue {
  return runtimeSettingDefinitions[key].defaultValue;
}

function normalizeRuntimeSettingInput(
  definition: RuntimeSettingDefinition<JsonValue>,
  input: unknown
): unknown {
  if (definition.valueType === 'boolean' && typeof input === 'string') {
    const trimmed = input.trim().toLowerCase();
    if (trimmed === 'true') {
      return true;
    }

    if (trimmed === 'false') {
      return false;
    }
  }

  if (definition.valueType !== 'json') {
    return input;
  }

  if (typeof input !== 'string') {
    return input;
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return definition.defaultValue;
  }

  return JSON.parse(trimmed);
}

export function serializeRuntimeSettingInput(
  key: string,
  input: unknown
): { value: JsonValue; valueType: RuntimeSettingValueType } {
  const definition = getRuntimeSettingDefinition(key);
  if (!definition) {
    throw new Error('Unknown runtime setting key.');
  }

  const normalizedInput = normalizeRuntimeSettingInput(definition, input);
  const parsed = definition.schema.safeParse(normalizedInput);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? 'Invalid runtime setting value.'
    );
  }

  return {
    value: parsed.data,
    valueType: definition.valueType,
  };
}

export function parseRuntimeSettingValue(
  key: string,
  value: unknown
): JsonValue {
  const definition = getRuntimeSettingDefinition(key);
  if (!definition) {
    throw new Error('Unknown runtime setting key.');
  }

  const parsed = definition.schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? 'Invalid runtime setting value.'
    );
  }

  return parsed.data;
}

export const runtimeLogLevelValues = runtimeLogLevelSchema.options;
