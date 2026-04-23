#!/usr/bin/env node
/**
 * Catalog validation script
 *
 * Validates i18n catalogs for:
 * 1. EN/ES key parity (all keys must exist in both locales)
 * 2. Valid JSON structure
 * 3. Flat dotted-key format (no nested objects)
 *
 * Usage: bun src/validate.ts
 * Exit code: 0 if all validations pass, 1 if any fail
 */

import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CATALOG_FILES: Record<string, string> = {
  platform: 'space-settings',
  author: 'admin',
  notifications: 'messages',
};

const LOCALES = ['en', 'es'] as const;

interface CatalogFile {
  domain: string;
  locale: string;
  path: string;
  data?: Record<string, unknown>;
  error?: string;
}

/**
 * Load a single catalog JSON file
 */
function loadCatalog(domain: string, locale: string): CatalogFile {
  const catalogFileName = CATALOG_FILES[domain];
  if (!catalogFileName) {
    return {
      domain,
      locale,
      path: '',
      error: `Unknown domain: ${domain}`,
    };
  }

  const catalogPath = resolve(
    __dirname,
    `./catalogs/${domain}/${catalogFileName}.${locale}.json`
  );

  try {
    const content = readFileSync(catalogPath, 'utf-8');
    const data = JSON.parse(content) as Record<string, unknown>;
    return { domain, locale, path: catalogPath, data };
  } catch (error) {
    return {
      domain,
      locale,
      path: catalogPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Validate key format (must be dotted notation like "auth.login.title")
 */
function validateKeyFormat(
  domain: string,
  locale: string,
  data: Record<string, unknown>
): string[] {
  const errors: string[] = [];
  const dotNotationRegex = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/;

  for (const key of Object.keys(data)) {
    if (!dotNotationRegex.test(key)) {
      errors.push(
        `[${domain}.${locale}] Key "${key}" does not follow dotted notation format ` +
          `(expected: "domain.section.key", got: "${key}")`
      );
    }
  }
  return errors;
}

/**
 * Validate that all values are strings (flat keys, no nesting)
 */
function validateFlatStructure(
  domain: string,
  locale: string,
  data: Record<string, unknown>
): string[] {
  const errors: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'string') {
      errors.push(
        `[${domain}.${locale}] Key "${key}" has non-string value (${typeof value}). ` +
          `Catalog must be flat with dotted keys only.`
      );
    }
  }
  return errors;
}

/**
 * Compare EN and ES key sets for a domain
 */
function validateParity(
  domain: string,
  enData: Record<string, unknown>,
  esData: Record<string, unknown>
): string[] {
  const errors: string[] = [];
  const enKeys = new Set(Object.keys(enData));
  const esKeys = new Set(Object.keys(esData));

  // Keys in EN but not in ES
  for (const key of enKeys) {
    if (!esKeys.has(key)) {
      errors.push(`[${domain}] Key "${key}" exists in EN but missing in ES`);
    }
  }

  // Keys in ES but not in EN
  for (const key of esKeys) {
    if (!enKeys.has(key)) {
      errors.push(`[${domain}] Key "${key}" exists in ES but missing in EN`);
    }
  }

  return errors;
}

/**
 * Main validation function
 */
function main(): number {
  console.log('🔍 Validating i18n catalogs...\n');

  const allErrors: string[] = [];
  const catalogs: Map<string, CatalogFile[]> = new Map();

  // Load all catalogs
  for (const domain of Object.keys(CATALOG_FILES)) {
    const domainCatalogs: CatalogFile[] = [];
    for (const locale of LOCALES) {
      const catalog = loadCatalog(domain, locale);
      domainCatalogs.push(catalog);

      if (catalog.error) {
        allErrors.push(
          `❌ Failed to load ${domain}.${locale}: ${catalog.error}`
        );
      }
    }
    catalogs.set(domain, domainCatalogs);
  }

  // Validate flat structure
  for (const [domain, domainCatalogs] of catalogs) {
    for (const catalog of domainCatalogs) {
      if (catalog.data) {
        const structureErrors = validateFlatStructure(
          domain,
          catalog.locale,
          catalog.data
        );
        allErrors.push(...structureErrors);

        const formatErrors = validateKeyFormat(
          domain,
          catalog.locale,
          catalog.data
        );
        allErrors.push(...formatErrors);
      }
    }
  }

  // Validate parity
  for (const domain of Object.keys(CATALOG_FILES)) {
    const domainCatalogs = catalogs.get(domain);
    if (!domainCatalogs) continue;

    const enCatalog = domainCatalogs.find((c) => c.locale === 'en');
    const esCatalog = domainCatalogs.find((c) => c.locale === 'es');

    if (enCatalog?.data && esCatalog?.data) {
      const parityErrors = validateParity(
        domain,
        enCatalog.data,
        esCatalog.data
      );
      allErrors.push(...parityErrors);
    }
  }

  // Report results
  if (allErrors.length === 0) {
    console.log('✅ All i18n catalogs are valid');
    console.log(`   • ${Object.keys(CATALOG_FILES).length} domains validated`);
    console.log(`   • ${LOCALES.length} locales per domain`);
    console.log('   • EN/ES key parity confirmed');
    console.log('   • Flat structure verified\n');
    return 0;
  }

  console.error('❌ i18n catalog validation failed:\n');
  for (const error of allErrors) {
    console.error(`   ${error}`);
  }
  console.error(`\n   Total errors: ${allErrors.length}\n`);
  return 1;
}

process.exit(main());
