import type { I18nLocale } from '@workspace/i18n-catalogs';
import { loadNotificationsMessages } from '@workspace/i18n-catalogs/notifications';

import type { Locale } from '../types.js';

const cache: Record<I18nLocale, Record<string, string>> = {
  en: {},
  es: {},
};

/** Eager-load and cache all supported locales. Call during app startup. */
export async function initializeMessages(locales: I18nLocale[]): Promise<void> {
  const promises = locales.map((locale) => {
    if (cache[locale] && Object.keys(cache[locale]).length > 0) {
      return Promise.resolve();
    }
    return loadNotificationsMessages(locale).then((messages) => {
      cache[locale] = messages;
    });
  });
  await Promise.all(promises);
}

/** Get cached catalog for a locale. Must call initializeMessages first. */
export function getMessages(locale: Locale): Record<string, string> {
  return cache[locale] ?? cache.en ?? {};
}

export const defaultLocale: Locale = 'en';
