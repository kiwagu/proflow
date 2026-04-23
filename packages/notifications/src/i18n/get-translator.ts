import { IntlMessageFormat } from 'intl-messageformat';
import { normalizePlatformLocale } from '@workspace/settings-runtime';

import type { Locale } from '../types.js';
import { defaultLocale, getMessages } from './messages.js';

export type Translate = (
  id: string,
  values?: Record<string, string | number | Date>
) => string;

function pickLocale(locale: string | undefined): Locale {
  return normalizePlatformLocale(locale);
}

export function getTranslator(
  locale: string | undefined,
  fallbackLocale: Locale = defaultLocale
): Translate {
  const primary = pickLocale(locale);
  const primaryCatalog = getMessages(primary);
  const fallbackCatalog = getMessages(fallbackLocale);

  return (id, values) => {
    const raw =
      primaryCatalog[id] ?? fallbackCatalog[id] ?? getMessages('en')[id] ?? id;
    try {
      const fmt = new IntlMessageFormat(raw, primary);
      return String(fmt.format(values ?? {}));
    } catch {
      return raw;
    }
  };
}
