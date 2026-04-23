import type { I18nLocale } from '../manifest.js';
import { assertValidLocale, CATALOG_MANIFEST } from '../manifest.js';

const CATALOGS: Record<I18nLocale, Record<string, string> | undefined> = {
  en: undefined,
  es: undefined,
};

async function importAuthorCatalog(
  locale: I18nLocale
): Promise<Record<string, string>> {
  // Centralized validation: ensures locale is in CATALOG_MANIFEST.author.supportedLocales
  assertValidLocale(locale);
  const supportedLocales = CATALOG_MANIFEST.author.supportedLocales;
  if (!supportedLocales.includes(locale)) {
    throw new Error(
      `Unsupported locale "${locale}" for author. Supported: ${supportedLocales.join(', ')}`
    );
  }

  // Static switch required for bundler module resolution
  // Only covers locales in CATALOG_MANIFEST.author.supportedLocales
  switch (locale) {
    case 'es':
      return (
        await import('../catalogs/author/admin.es.json', {
          with: { type: 'json' },
        })
      ).default as Record<string, string>;
    case 'en':
    default:
      return (
        await import('../catalogs/author/admin.en.json', {
          with: { type: 'json' },
        })
      ).default as Record<string, string>;
  }
}

export async function loadAuthorMessages(
  locale: I18nLocale
): Promise<Record<string, string>> {
  if (CATALOGS[locale]) {
    return CATALOGS[locale];
  }

  const catalog = await importAuthorCatalog(locale);
  CATALOGS[locale] = catalog;
  return catalog;
}

export type { I18nLocale };
