import type { PlatformLocale } from '@workspace/settings-runtime';
import { PLATFORM_LOCALES } from '@workspace/settings-runtime';

export type I18nDomain = 'platform' | 'author' | 'notifications';

export type I18nLocale = PlatformLocale;

export const SUPPORTED_LOCALES: readonly I18nLocale[] = PLATFORM_LOCALES;

export const CATALOG_MANIFEST = {
  platform: {
    domains: ['space-settings'] as const,
    supportedLocales: SUPPORTED_LOCALES,
  },
  author: {
    domains: ['admin'] as const,
    supportedLocales: SUPPORTED_LOCALES,
  },
  notifications: {
    domains: ['messages'] as const,
    supportedLocales: SUPPORTED_LOCALES,
  },
} as const;

export type PlatformCatalogDomain =
  (typeof CATALOG_MANIFEST.platform.domains)[number];
export type AuthorCatalogDomain =
  (typeof CATALOG_MANIFEST.author.domains)[number];
export type NotificationsCatalogDomain =
  (typeof CATALOG_MANIFEST.notifications.domains)[number];

export function assertValidLocale(value: unknown): asserts value is I18nLocale {
  if (!SUPPORTED_LOCALES.includes(value as I18nLocale)) {
    throw new Error(
      `Invalid locale "${value}". Supported: ${SUPPORTED_LOCALES.join(', ')}`
    );
  }
}

export interface LocaleOption {
  value: I18nLocale;
  label: string;
}

/**
 * Generate locale options from translator and app key.
 * Supports all apps: 'platform', 'author', 'notifications'.
 * Uses CATALOG_MANIFEST as single source of truth for supported locales.
 *
 * Example: getLocaleOptions(t, 'platform') → [{value: 'en', label: 'English'}, {value: 'es', label: 'Spanish'}]
 */
export function getLocaleOptions(
  translator: (key: string) => string,
  appKey: keyof typeof CATALOG_MANIFEST
): LocaleOption[] {
  const locales = CATALOG_MANIFEST[appKey].supportedLocales;
  return locales.map((locale) => ({
    value: locale,
    label: translator(`runtimeSettings.options.locale.${locale}`),
  }));
}
