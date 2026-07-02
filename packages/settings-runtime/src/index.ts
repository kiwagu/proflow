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
  null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };

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

// --- Entitlements -----------------------------------------------------------
// Commercial, plan-gated capabilities. Same scope-aware runtime-settings
// machinery as feature flags, but a distinct `platform.entitlement.*` key
// namespace so a commercial dimension never reads as an internal rollout
// toggle. Source of truth is a scoped runtime_settings row (global/org/space),
// resolved global→org→space with org∧space AND-composition (a space's plan can
// never exceed its org's). See ADR-0022 (+ Addendum A).
//
// `advancedStructuralView` is ONE generic commercial unit — the structural
// (KB-containment tree) display of the membership lenses. WHICH lenses it
// unlocks (Shared with/by me, Starred, Trash — never the Recent log) is a
// render-side opt-in constant, not a billing dimension.

export const PLATFORM_ENTITLEMENT_KEYS = {
  advancedStructuralView: 'advanced_structural_view',
} as const;

export type PlatformEntitlementKey =
  (typeof PLATFORM_ENTITLEMENT_KEYS)[keyof typeof PLATFORM_ENTITLEMENT_KEYS];

export const PLATFORM_ENTITLEMENT_SETTING_KEYS = {
  [PLATFORM_ENTITLEMENT_KEYS.advancedStructuralView]:
    'platform.entitlement.advanced_structural_view',
} as const;

export type PlatformEntitlementRuntimeSettingKey =
  (typeof PLATFORM_ENTITLEMENT_SETTING_KEYS)[PlatformEntitlementKey];

const platformEntitlementRuntimeSettingKeyValues = Object.values(
  PLATFORM_ENTITLEMENT_SETTING_KEYS
) as PlatformEntitlementRuntimeSettingKey[];

export const defaultPlatformEntitlements: Record<
  PlatformEntitlementKey,
  boolean
> = {
  [PLATFORM_ENTITLEMENT_KEYS.advancedStructuralView]: false,
};

export function getPlatformEntitlementRuntimeSettingKey(
  key: PlatformEntitlementKey
): PlatformEntitlementRuntimeSettingKey {
  return PLATFORM_ENTITLEMENT_SETTING_KEYS[key];
}

export function isPlatformEntitlementRuntimeSettingKey(
  key: string
): key is PlatformEntitlementRuntimeSettingKey {
  return platformEntitlementRuntimeSettingKeyValues.includes(
    key as PlatformEntitlementRuntimeSettingKey
  );
}

// --- Media upload limit -----------------------------------------------------
// The org-configurable MAX-UPLOAD size for KB media (ADR-0026 AMENDMENT §A3).
// A `platform.*` infrastructure dial (operator config), NOT a KB-app domain
// attribute — so it is NOT a `space.knowledge.*` verb and NOT a `kb.*` row; it
// reuses this runtime-settings registry verbatim (org scope + numeric value_type
// + audited RPC + admin RLS already exist).
//
// SOFT default 200 MB (209715200); HARD system cap 5 GB (5368709120). The HARD cap
// is the SINGLE SOURCE `HARD_MAX_UPLOAD_BYTES` in `@workspace/knowledge-contracts`
// (mirrored to the bucket file_size_limit + storage-api FILE_SIZE_LIMIT +
// config.toml). This constant MUST equal it; a drift would let the write-time
// `.max()` disagree with the storage/authorizer cap. The resolver clamps to the
// same value at read time as belt-and-braces.
// Exported so the platform org-settings UI (MB↔bytes number form + hard-cap
// client validation) reads the SAME soft default / hard cap that the write-time
// schema `.max()` enforces — one source, no drift.
// CANONICAL SOURCE for both numbers. @workspace/knowledge-contracts re-exports these
// as DEFAULT_MAX_UPLOAD_BYTES / HARD_MAX_UPLOAD_BYTES (the media-domain names the KB
// authorizer + client use) — defined ONCE here, no second literal, no drift.
export const MEDIA_MAX_UPLOAD_DEFAULT_BYTES = 209715200; // 200 MB (soft default)
export const MEDIA_MAX_UPLOAD_HARD_CAP_BYTES = 5368709120; // 5 GiB (hard system cap)

const mediaMaxUploadBytesSchema = z
  .number()
  .int()
  .positive()
  .max(MEDIA_MAX_UPLOAD_HARD_CAP_BYTES);

export const RUNTIME_SETTING_KEYS = {
  platformLocale: 'platform.locale',
  runtimeLogLevel: 'runtime.log_level',
  platformFeatureFlagOrganizationSettings:
    PLATFORM_FEATURE_FLAG_SETTING_KEYS[
      PLATFORM_FEATURE_FLAG_KEYS.organizationSettings
    ],
  platformEntitlementAdvancedStructuralView:
    PLATFORM_ENTITLEMENT_SETTING_KEYS[
      PLATFORM_ENTITLEMENT_KEYS.advancedStructuralView
    ],
  mediaMaxUploadBytes: 'platform.media.max_upload_bytes',
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
  [RUNTIME_SETTING_KEYS.platformEntitlementAdvancedStructuralView]: {
    key: RUNTIME_SETTING_KEYS.platformEntitlementAdvancedStructuralView,
    valueType: 'boolean',
    allowedScopes: ['global', 'organization', 'space'],
    isPublic: false,
    defaultValue:
      defaultPlatformEntitlements[
        PLATFORM_ENTITLEMENT_KEYS.advancedStructuralView
      ],
    schema: platformFeatureFlagBooleanSchema,
  },
  [RUNTIME_SETTING_KEYS.mediaMaxUploadBytes]: {
    key: RUNTIME_SETTING_KEYS.mediaMaxUploadBytes,
    valueType: 'number',
    // org is the editable governance scope; global lets the operator move the
    // platform-wide default without a code change. space/user deliberately excluded.
    allowedScopes: ['global', 'organization'],
    // isPublic: an uploader (org MEMBER) must READ the resolved limit for client
    // pre-validation; writes stay org-admin-only via the RPC's own authz.
    isPublic: true,
    defaultValue: MEDIA_MAX_UPLOAD_DEFAULT_BYTES,
    // .max = the 5 GB hard cap → WRITE-time rejection of an over-cap value via
    // serializeRuntimeSettingInput. First real user of the number value_type.
    schema: mediaMaxUploadBytesSchema,
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

  if (definition.valueType === 'number' && typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      return input;
    }

    const parsed = Number(trimmed);
    // Return the number when the string is a clean numeric; else pass the raw
    // string through so the schema surfaces the validation error (fail-closed).
    return Number.isFinite(parsed) ? parsed : input;
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
