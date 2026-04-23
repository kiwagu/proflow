# Notifications (GoTrue `send_email` hook + notifications-service)

## Components

- **`@workspace/notifications`** — **React Email** templates + **`renderEmail()`** (required for all bodies), i18n, **`createSmtpTransportFromEnv` / nodemailer SMTP**, `sendNotification()` — **canonical mail implementation**.
- **`services/notifications`** (workspace package name `@workspace/notifications-service`) — Bun HTTP server + JetStream consumers; **sends only through `@workspace/notifications`** (no duplicate SMTP stack).
  - **`POST /v1/notifications/email`** — app-triggered email (requires bearer token).
  - **`POST /v1/hooks/gotrue/send-email`** — internal endpoint for GoTrue `send_email` hook payloads (requires bearer token).
- **Edge Function `email_sender`** — GoTrue **send_email** hook verifier/forwarder:
  - verifies Standard Webhooks signature from Auth,
  - forwards payload to notifications-service **`POST /v1/hooks/gotrue/send-email`**.
- **Space invite email** — **`apps/platform`** publishes to JetStream (`PLATFORM_NOTIFY` / `platform.notify.v1.space_invite_email`) **after** `rpc_create_space_invite` succeeds. **`NATS_URL`** must be set on the platform server (same broker as `services/notifications`, e.g. `nats://127.0.0.1:4222` when the dev stack publishes NATS to the host). No Postgres trigger or Edge fan-out for invites.

## Prerequisites

1. Start `notifications-service` with SMTP variables and internal token:
   - `NOTIFICATIONS_INTERNAL_TOKEN` (bearer token)
   - `SMTP_*` (see `services/notifications/README.md`)
2. Configure forwarding variables for Edge Function `email_sender`:
   - `NOTIFICATIONS_SERVICE_URL` (e.g. `http://172.22.0.1:3010` on Linux bridge network)
   - `NOTIFICATIONS_INTERNAL_TOKEN` (must match service token)

Space-invite links in email use **`GATEWAY_ENTRY_ORIGIN`** and **`NEXT_PUBLIC_GATEWAY_PLATFORM_PATH`** — the same keys as the gateway / platform; avoid invite-only duplicate env names (see `.cursor/rules/monorepo-env-minimalism.mdc`).

## Enable the GoTrue hook (self-hosted)

In `infra/dev/supabase/.env` (see `.env.example`):

- `GOTRUE_HOOK_SEND_EMAIL_ENABLED=true`
- `GOTRUE_HOOK_SEND_EMAIL_URI=https://kong:8443/functions/v1/email_sender`
- `GOTRUE_HOOK_SEND_EMAIL_SECRETS=v1,whsec_<secret>` (must match **Standard Webhooks** format; same value is exposed to Edge as `AUTH_HOOK_SEND_EMAIL_SECRETS`)
- `NOTIFICATIONS_SERVICE_URL=http://172.22.0.1:3010` (or another reachable internal URL)
- `NOTIFICATIONS_INTERNAL_TOKEN=<token>` (same token expected by notifications-service)

Optional:

- `AUTH_EMAIL_CONFIRM_PATH` (default `/platform/auth/confirm` for `apps/platform`) — used by notifications-service to build auth links; must match the platform route that calls `verifyOtp` with `token_hash` and `type`.

Restart auth + functions containers after changes.

## Local verification (Maildev / Inbucket)

There are two dev mail UIs in this repo:

- **Maildev** (root dev stack): `infra/dev/docker-compose.yml` runs `maildev` on:
  - SMTP: `127.0.0.1:2500`
  - UI: `http://127.0.0.1:9090`
- **Inbucket** (Supabase upstream dev overlay): `infra/dev/supabase/dev/docker-compose.dev.yml` runs `inbucket` and also binds loopback ports. **Do not run both overlays at the same time** if they bind the same ports.

Steps:

1. Start notifications-service:

```bash
bun run --cwd services/notifications dev
```

2. Ensure SMTP for notifications-service points at your chosen dev SMTP host/port (Maildev or Inbucket).
3. Enable the hook env vars above.
4. Trigger **sign up** or **password reset** from the platform app.
5. Open the mail UI and confirm the email content.

## Per-user locale

GoTrue `user.user_metadata.locale` (or `lang` / `language`) is read by `localeFromGoTrueUser()` to pick `en` / `de` message catalogs.

## HTTP service (non-GoTrue sends)

```bash
NOTIFICATIONS_INTERNAL_TOKEN=dev-secret \
SMTP_HOST=... SMTP_PORT=... SMTP_SECURE=false SMTP_FROM=... \
bun run --cwd services/notifications dev
```

```bash
curl -sS -X POST http://127.0.0.1:3010/v1/notifications/email \
  -H "Authorization: Bearer dev-secret" \
  -H "Content-Type: application/json" \
  -d '{"channel":"email","to":"you@example.com","locale":"en","template":{"templateKey":"auth_email_action","data":{"actionType":"recovery","confirmUrl":"https://example.com/auth/confirm?token_hash=x&type=recovery"}}}'
```
