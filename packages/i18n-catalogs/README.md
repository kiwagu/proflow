# @workspace/i18n-catalogs

Centralized translation catalogs for all application domains.

## Domains

- **platform**: Platform app UI translations
- **author**: Payload CMS admin UI translations
- **graph**: Knowledge-graph consumer pages (shadcn, not the admin)
- **workbench**: Local-first workbench surfaces — editor shell (toolbar, table picker, code-block accessory), file explorer, command palette
- **notifications**: Transactional email translations

## Architecture

Each domain supports lazy-loaded per-locale catalogs:

```ts
import { loadPlatformSpaceSettingsMessages } from '@workspace/i18n-catalogs/platform';
import { loadAuthorMessages } from '@workspace/i18n-catalogs/author';
import { loadNotificationsMessages } from '@workspace/i18n-catalogs/notifications';
import {
  createWorkbenchTranslator,
  loadWorkbenchMessages,
} from '@workspace/i18n-catalogs/workbench';

// Load only required locale
const en = await loadPlatformSpaceSettingsMessages('en');
const es = await loadAuthorMessages('es');

// Consumer surfaces take a translator, never a catalog
const t = createWorkbenchTranslator(await loadWorkbenchMessages('en'));
t('workbench.files.importing', { count: 3 }); // "3 importing"
```

The `graph` and `workbench` domains ship a `create*Translator(messages)` helper:
`t(key, vars?)` does `{name}` interpolation and returns the key itself when a
string is missing, so a gap is visible rather than blank. Call sites pass
literal keys (the shared lint config rejects computed keys), which keeps every
key grep-able against the catalog.

Lazy loading enables:

- Per-locale code splitting on client
- No unnecessary catalog bloat in bundles
- Clean manifest-driven API
