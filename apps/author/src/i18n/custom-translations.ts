import { enTranslations } from '@payloadcms/translations/languages/en';
import type { NestedKeysStripped } from '@payloadcms/translations';
import { loadAuthorMessages } from '@workspace/i18n-catalogs/author';
const [enMessages, esMessages] = await Promise.all([
  loadAuthorMessages('en'),
  loadAuthorMessages('es'),
]);

export const customTranslations = {
  en: enMessages,
  es: esMessages,
} as const;

export type CustomTranslationsObject = typeof customTranslations.en &
  typeof enTranslations;

export type CustomTranslationsKeys =
  NestedKeysStripped<CustomTranslationsObject>;
