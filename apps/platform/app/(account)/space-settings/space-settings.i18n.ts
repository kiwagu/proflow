import {
  PLATFORM_LOCALES,
  defaultPlatformLocale,
  isPlatformLocale,
  resolvePlatformLocaleFromAcceptLanguage,
} from '@workspace/settings-runtime';
import { loadPlatformSpaceSettingsMessages } from '@workspace/i18n-catalogs/platform';
import { getLocaleOptions } from '@workspace/i18n-catalogs';

type MessageCatalog = Readonly<Record<string, string>>;
export type SpaceSettingsLocale = 'en' | 'es';

export type PreloadedSpaceSettingsMessages = Readonly<
  Partial<Record<SpaceSettingsLocale, MessageCatalog>>
>;

const catalogCache: Record<string, MessageCatalog | undefined> = {};

function getMessages(locale: string): MessageCatalog {
  const messages = catalogCache[locale];
  if (!messages) {
    throw new Error(
      `Space settings messages for locale "${locale}" not initialized for this render path.`
    );
  }
  return messages;
}

function getOptionalMessages(locale: string): MessageCatalog | undefined {
  return catalogCache[locale];
}

const defaultLocale = defaultPlatformLocale as SpaceSettingsLocale;

const supportedSpaceSettingsLocales =
  PLATFORM_LOCALES as readonly SpaceSettingsLocale[];

export async function initializeSpaceSettingsMessages(
  locale: SpaceSettingsLocale
): Promise<PreloadedSpaceSettingsMessages> {
  const catalog = await loadPlatformSpaceSettingsMessages(locale);
  catalogCache[locale] = catalog;

  return {
    [locale]: catalog,
  };
}

export function primeSpaceSettingsMessages(
  messages: PreloadedSpaceSettingsMessages
): void {
  for (const locale of supportedSpaceSettingsLocales) {
    const catalog = messages[locale];
    if (catalog) {
      catalogCache[locale] = catalog;
    }
  }
}

export function isSpaceSettingsLocale(
  value: unknown
): value is SpaceSettingsLocale {
  return isPlatformLocale(value);
}

export function resolveSpaceSettingsLocale(
  acceptLanguage: string | null | undefined
): SpaceSettingsLocale {
  return resolvePlatformLocaleFromAcceptLanguage(acceptLanguage);
}

export function getSupportedSpaceSettingsLocales(): readonly SpaceSettingsLocale[] {
  return supportedSpaceSettingsLocales;
}

export function getSpaceSettingsTranslator(locale: SpaceSettingsLocale) {
  const catalog = getMessages(locale);
  const fallbackCatalog = getOptionalMessages(defaultLocale);

  return (
    id: string,
    values?: Record<string, string | number | boolean | null | undefined>
  ): string => {
    const template = catalog[id] ?? fallbackCatalog?.[id] ?? id;
    if (!values) {
      return template;
    }

    return template.replace(/\{(\w+)\}/g, (_match: string, token: string) => {
      const value = values[token];
      if (value === null || value === undefined) {
        return '';
      }
      return String(value);
    });
  };
}

export async function getServerSpaceSettingsTranslator(
  locale: SpaceSettingsLocale
) {
  await initializeSpaceSettingsMessages(locale);
  return getSpaceSettingsTranslator(locale);
}

export function getSpaceSettingsLocaleOptions(
  t: ReturnType<typeof getSpaceSettingsTranslator>
) {
  return getLocaleOptions(t, 'platform');
}

export type SpaceSettingsTranslator = ReturnType<
  typeof getSpaceSettingsTranslator
>;
