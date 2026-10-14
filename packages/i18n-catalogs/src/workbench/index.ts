import type { I18nLocale } from '../manifest.js';
import { assertValidLocale, CATALOG_MANIFEST } from '../manifest.js';
import english from '../catalogs/workbench/workbench.en.json' with { type: 'json' };
import spanish from '../catalogs/workbench/workbench.es.json' with { type: 'json' };

/**
 * Loader for the local-first WORKBENCH surfaces: the document editor shell
 * (toolbar, table picker, code-block accessory), the file explorer and the
 * command palette. Reads `catalogs/workbench/workbench.{locale}.json`.
 *
 * The surface packages themselves stay catalog-free: they take a translator
 * (or a resolved labels object) from the host, so the same components run
 * in a test with a stub and in the app with a loaded catalog.
 */

const CATALOGS: Record<I18nLocale, Record<string, string> | undefined> = {
  en: undefined,
  es: undefined,
};

async function importWorkbenchCatalog(
  locale: I18nLocale
): Promise<Record<string, string>> {
  assertValidLocale(locale);
  const supportedLocales = CATALOG_MANIFEST.workbench.supportedLocales;
  if (!supportedLocales.includes(locale)) {
    throw new Error(
      `Unsupported locale "${locale}" for workbench. Supported: ${supportedLocales.join(', ')}`
    );
  }

  // Static switch required for bundler module resolution.
  switch (locale) {
    case 'es':
      return spanish;
    case 'en':
    default:
      return english;
  }
}

export async function loadWorkbenchMessages(
  locale: I18nLocale
): Promise<Record<string, string>> {
  if (CATALOGS[locale]) {
    return CATALOGS[locale];
  }

  const catalog = await importWorkbenchCatalog(locale);
  CATALOGS[locale] = catalog;
  return catalog;
}

/**
 * A minimal flat-catalog translator: `t(key, vars?)` looks the key up and
 * interpolates `{name}` placeholders. Returns the key itself when absent so a
 * missing string is visible (not silently blank) — the catalog is the authority.
 */
export type WorkbenchTranslator = (
  key: string,
  vars?: Record<string, string | number>
) => string;

export function createWorkbenchTranslator(
  messages: Record<string, string>
): WorkbenchTranslator {
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
