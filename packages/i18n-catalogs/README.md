# @workspace/i18n-catalogs

Centralized translation catalogs for all application domains.

## Domains

- **platform**: Platform app UI translations
- **author**: Payload CMS admin UI translations
- **notifications**: Transactional email translations

## Architecture

Each domain supports lazy-loaded per-locale catalogs:

```ts
import { loadPlatformSpaceSettingsMessages } from '@workspace/i18n-catalogs/platform';
import { loadAuthorMessages } from '@workspace/i18n-catalogs/author';
import { loadNotificationsMessages } from '@workspace/i18n-catalogs/notifications';

// Load only required locale
const en = await loadPlatformSpaceSettingsMessages('en');
const es = await loadAuthorMessages('es');
```

Lazy loading enables:

- Per-locale code splitting on client
- No unnecessary catalog bloat in bundles
- Clean manifest-driven API
