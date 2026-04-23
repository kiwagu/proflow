import type { I18nLocale } from '../manifest.js';
import { assertValidLocale, CATALOG_MANIFEST } from '../manifest.js';

const CATALOGS: Record<I18nLocale, Record<string, string> | undefined> = {
  en: undefined,
  es: undefined,
};

async function importNotificationsCatalog(
  locale: I18nLocale
): Promise<Record<string, string>> {
  // Centralized validation: ensures locale is in CATALOG_MANIFEST.notifications.supportedLocales
  assertValidLocale(locale);
  const supportedLocales = CATALOG_MANIFEST.notifications.supportedLocales;
  if (!supportedLocales.includes(locale)) {
    throw new Error(
      `Unsupported locale "${locale}" for notifications. Supported: ${supportedLocales.join(', ')}`
    );
  }

  // Static switch required for bundler module resolution
  // Only covers locales in CATALOG_MANIFEST.notifications.supportedLocales
  switch (locale) {
    case 'es':
      return (
        await import('../catalogs/notifications/messages.es.json', {
          with: { type: 'json' },
        })
      ).default as Record<string, string>;
    case 'en':
    default:
      return (
        await import('../catalogs/notifications/messages.en.json', {
          with: { type: 'json' },
        })
      ).default as Record<string, string>;
  }
}

export async function loadNotificationsMessages(
  locale: I18nLocale
): Promise<Record<string, string>> {
  if (CATALOGS[locale]) {
    return CATALOGS[locale];
  }

  const catalog = await importNotificationsCatalog(locale);
  CATALOGS[locale] = catalog;
  return catalog;
}

export type { I18nLocale };
