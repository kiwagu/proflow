# notifications-service

HTTP + outbox runtime that sends mail **through `@workspace/notifications`** (`createSmtpTransportFromEnv`, `sendNotification`, templates). **Nodemailer** is a dependency of the **package**, not duplicated here. SMS/push later. Delivery is driven by the Postgres universal outbox ledger with `pgmq` handling queue transport mechanics.

## Endpoints

- `GET /health` — liveness.
- `GET /v1/outbox/metrics` — internal outbox observability snapshot. Requires header `Authorization: Bearer <NOTIFICATIONS_INTERNAL_TOKEN>`. Optional query params: `failedSinceHours`, `processingStaleAfterSeconds`.
- `POST /v1/notifications/email` — enqueue an email notification into the universal outbox. Requires header `Authorization: Bearer <NOTIFICATIONS_INTERNAL_TOKEN>` and a JSON body matching `EmailNotificationInput` from `@workspace/notifications`. Optional header `Idempotency-Key` enables caller-defined dedupe semantics.
- `POST /v1/hooks/gotrue/send-email` — enqueue a deduplicated auth email request into the universal outbox. Requires header `Authorization: Bearer <NOTIFICATIONS_INTERNAL_TOKEN>`.

## Environment

Keep env surface small: reuse **the same names** as the gateway / platform where invite links must match (see `.cursor/rules/monorepo-env-minimalism.mdc`).

| Variable                                                          | Description                                                                                                                               |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                                            | Listen port (default `3010`).                                                                                                             |
| `HOST`                                                            | Bind address (default `0.0.0.0`).                                                                                                         |
| `NOTIFICATIONS_INTERNAL_TOKEN`                                    | Bearer token for `/v1/notifications/email` and GoTrue hook routes.                                                                        |
| `AUTH_EMAIL_CONFIRM_PATH`                                         | Path segment for auth confirm links (default `/auth/confirm`).                                                                            |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | SMTP.                                                                                                                                     |
| `SMTP_FROM` / `SMTP_ADMIN_EMAIL`                                  | From address.                                                                                                                             |
| `NOTIFICATIONS_DEFAULT_LOCALE`                                    | Optional. Default locale for **all** templated mail in this process (`en` / `de`).                                                        |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`                       | **Required** for the universal outbox worker and for GoTrue hook enqueue.                                                                 |
| `NOTIFICATIONS_OUTBOX_CONSUMER`                                   | Optional consumer identity recorded in outbox claims.                                                                                     |
| `NOTIFICATIONS_OUTBOX_BATCH_SIZE`                                 | Optional batch size per poll.                                                                                                             |
| `NOTIFICATIONS_OUTBOX_POLL_INTERVAL_MS`                           | Optional polling interval for the outbox worker.                                                                                          |
| `NOTIFICATIONS_OUTBOX_RETRY_SECONDS`                              | Optional retry delay for transient failures.                                                                                              |
| `GATEWAY_ENTRY_ORIGIN`                                            | Required for rendering space invite links from outbox jobs. Must match `apps/web` / monorepo `GATEWAY_ENTRY_ORIGIN`.                      |
| `NEXT_PUBLIC_GATEWAY_PLATFORM_PATH`                               | Required for rendering space invite links from outbox jobs. Must match `apps/platform` / `@workspace/gateway-auth` (default `/platform`). |

## Run (development)

From the repo root, **`bun run dev`** starts this service **once** via **Turbo** alongside other workspace apps (`PORT` default **3010**). **`apps/platform`** `bun run dev` runs **Next only**; use root dev or `turbo dev` when you need the full stack including notifications.

To run **only** notifications (e.g. without the rest of the monorepo):

```bash
bun run --cwd services/notifications dev
```

## Integration with Supabase Auth

GoTrue is normally wired to the Edge Function `email_sender`, which verifies the Auth hook signature and forwards to this service. Auth mail, direct internal email requests, and new space invites are persisted into `public.outbox_jobs` with stable idempotency keys; `pgmq` provides the low-level read / visibility-timeout / delete / retry transport while the ledger remains the canonical status and audit surface. `GET /v1/outbox/metrics` exposes backlog per channel plus lag, retry, and terminal-failure signals for operators. Shell apps must not send mail or depend on nodemailer.
