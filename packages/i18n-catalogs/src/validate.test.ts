import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CATALOG_FILES: Record<string, string> = {
  platform: 'space-settings',
  author: 'admin',
  notifications: 'messages',
};

const LOCALES = ['en', 'es'] as const;

interface Catalog {
  domain: string;
  locale: string;
  data: Record<string, unknown>;
}

function loadCatalog(domain: string, locale: string): Catalog {
  const catalogFileName = CATALOG_FILES[domain];
  if (!catalogFileName) {
    throw new Error(`Unknown domain: ${domain}`);
  }

  const catalogPath = resolve(
    __dirname,
    `./catalogs/${domain}/${catalogFileName}.${locale}.json`
  );

  const content = readFileSync(catalogPath, 'utf-8');
  const data = JSON.parse(content) as Record<string, unknown>;
  return { domain, locale, data };
}

describe('i18n-catalogs', () => {
  describe('structure', () => {
    for (const domain of Object.keys(CATALOG_FILES)) {
      for (const locale of LOCALES) {
        it(`${domain}.${locale} should be valid JSON with flat structure`, () => {
          const catalog = loadCatalog(domain, locale);

          // Check all values are strings
          for (const [key, value] of Object.entries(catalog.data)) {
            expect(
              typeof value === 'string',
              `${domain}.${locale} key "${key}" should have string value, got ${typeof value}`
            ).toBe(true);
          }
        });

        it(`${domain}.${locale} keys should follow dotted notation format`, () => {
          const catalog = loadCatalog(domain, locale);
          const dotNotationRegex = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/;

          for (const key of Object.keys(catalog.data)) {
            expect(
              dotNotationRegex.test(key),
              `${domain}.${locale} key "${key}" does not follow dotted notation`
            ).toBe(true);
          }
        });
      }
    }
  });

  describe('parity', () => {
    for (const domain of Object.keys(CATALOG_FILES)) {
      it(`${domain} should have identical keys between en and es`, () => {
        const enCatalog = loadCatalog(domain, 'en');
        const esCatalog = loadCatalog(domain, 'es');

        const enKeys = new Set(Object.keys(enCatalog.data));
        const esKeys = new Set(Object.keys(esCatalog.data));

        // Check EN keys are in ES
        for (const key of enKeys) {
          expect(esKeys.has(key), `en key "${key}" missing in es`).toBe(true);
        }

        // Check ES keys are in EN
        for (const key of esKeys) {
          expect(enKeys.has(key), `es key "${key}" missing in en`).toBe(true);
        }

        // Check same count
        expect(
          enKeys.size === esKeys.size,
          `en has ${enKeys.size} keys, es has ${esKeys.size} keys`
        ).toBe(true);
      });
    }
  });

  describe('content', () => {
    for (const domain of Object.keys(CATALOG_FILES)) {
      for (const locale of LOCALES) {
        it(`${domain}.${locale} should not be empty`, () => {
          const catalog = loadCatalog(domain, locale);
          expect(
            Object.keys(catalog.data).length > 0,
            `${domain}.${locale} has no keys`
          ).toBe(true);
        });

        it(`${domain}.${locale} should not have empty string values`, () => {
          const catalog = loadCatalog(domain, locale);

          for (const [key, value] of Object.entries(catalog.data)) {
            expect(
              (value as string).length > 0,
              `${domain}.${locale} key "${key}" has empty string value`
            ).toBe(true);
          }
        });
      }
    }
  });
});
