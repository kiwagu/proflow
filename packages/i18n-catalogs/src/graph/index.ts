import type { I18nLocale } from '../manifest.js';
import { assertValidLocale, CATALOG_MANIFEST } from '../manifest.js';

/**
 * Loader for the knowledge-graph CONSUMER render surface catalog (shadcn pages
 * under `/author/graph/*`, NOT the Payload admin). Mirrors `loadAuthorMessages`
 * but reads `catalogs/graph/graph.{locale}.json` so the consumer strings stay
 * isolated from the operator `admin.*` catalog (carve-out).
 */

const CATALOGS: Record<I18nLocale, Record<string, string> | undefined> = {
  en: undefined,
  es: undefined,
};

async function importGraphCatalog(
  locale: I18nLocale
): Promise<Record<string, string>> {
  assertValidLocale(locale);
  const supportedLocales = CATALOG_MANIFEST.graph.supportedLocales;
  if (!supportedLocales.includes(locale)) {
    throw new Error(
      `Unsupported locale "${locale}" for graph. Supported: ${supportedLocales.join(', ')}`
    );
  }

  // Static switch required for bundler module resolution.
  switch (locale) {
    case 'es':
      return (
        await import('../catalogs/graph/graph.es.json', {
          with: { type: 'json' },
        })
      ).default as Record<string, string>;
    case 'en':
    default:
      return (
        await import('../catalogs/graph/graph.en.json', {
          with: { type: 'json' },
        })
      ).default as Record<string, string>;
  }
}

export async function loadGraphMessages(
  locale: I18nLocale
): Promise<Record<string, string>> {
  if (CATALOGS[locale]) {
    return CATALOGS[locale];
  }

  const catalog = await importGraphCatalog(locale);
  CATALOGS[locale] = catalog;
  return catalog;
}

/**
 * A minimal flat-catalog translator: `t(key, vars?)` looks the key up and
 * interpolates `{name}` placeholders. Returns the key itself when absent so a
 * missing string is visible (not silently blank) — the catalog is the authority.
 */
export type GraphTranslator = (
  key: string,
  vars?: Record<string, string | number>
) => string;

export function createGraphTranslator(
  messages: Record<string, string>
): GraphTranslator {
  return (key, vars) => {
    const template = messages[key] ?? key;
    if (!vars) {
      return template;
    }
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in vars ? String(vars[name]) : match
    );
  };
}

export type { I18nLocale };
