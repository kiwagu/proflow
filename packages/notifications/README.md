# @workspace/notifications

Shared notification library: typed channels (email today; SMS/push stubs), ICU-friendly i18n, and **React Email** templates.

## Email (React Email)

**Required:** all outbound HTML/text/subject must be produced via **`renderEmail()`** and a template component in **`src/email/templates/`**. Do not concatenate HTML for SMTP elsewhere.

- `renderEmail(locale, template)` — async HTML + plain text + subject. Template keys include **`auth_email_action`** (GoTrue-style) and **`space_invite`**.
- `prepareAuthEmailFromGoTrueHook(payload, confirmPath)` — maps Supabase Auth **send_email** hook payload to a rendered message.
- `sendNotification(request, { email })` — dispatches using an `EmailTransport`.
- `SmtpEmailTransport` / `createSmtpTransportFromEnv()` — **nodemailer**-backed SMTP (env: `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` / `SMTP_ADMIN_EMAIL`, optional auth). This is the **primary** transport for the Bun **`services/notifications`** runtime and any other internal sender. **Do not** add nodemailer to shell apps (`apps/platform`, `apps/author`, …).

## i18n

- Message catalogs live in root JSON files: `i18n/notifications/messages.en.json` and `i18n/notifications/messages.es.json`.
- Supported locales are `en` and `es`. Use ICU placeholders in strings; `getTranslator(locale)` formats via `intl-messageformat`.
- Translation keys follow dotted camelCase semantics (for example `email.auth.subject.emailChange`, `email.spaceInvite.linkFallback`).
- Locale normalization is shared with Platform via `@workspace/settings-runtime` (`normalizePlatformLocale`, Accept-Language contract).
- Unknown locales fall back to `defaultLocale` (`en`), then `en` catalog keys.

## Supabase Edge bundle

GoTrue cannot import this package directly. Build a single ESM bundle for Edge Functions:

```bash
bun run notifications:bundle
```

Output: `infra/dev/supabase/volumes/functions/_shared/notifications.bundle.mjs` (gitignored; see that folder’s `README.md`).

## Tests

```bash
bun run --cwd packages/notifications test
```
