# Local dev stack (ProFlow)

Orchestration lives under this directory: root `docker-compose.yml` (Mongo, Maildev, nginx) and `supabase/` (self-hosted Supabase).

## Force-clean stack reset (`FORCE_CLEAN=1`)

Use when you want an empty Postgres volume and clean containers (same idea as a full local repro).

**Typical order:**

1. **Recreate the stack** (from repo root). After a **force-clean**, the script **waits for Postgres** and runs **`make db-push`** automatically (migrations + **`db-sync-identity-secret`**). To skip that step (e.g. remote DB only): **`SKIP_STACK_DB_PUSH=1`**.

   ```bash
   make stack-recreate-clean RECREATE_YES=1
   ```

   Same as `make stack-recreate FORCE_CLEAN=1 RECREATE_YES=1`. **`RECREATE_YES=1`** skips the `Proceed?` prompt; omit it for an interactive confirm.

2. If you used **`SKIP_STACK_DB_PUSH=1`**, apply migrations and the identity fan-out secret yourself:

   ```bash
   make db-push
   ```

   `db-push` runs the Supabase CLI against your self-hosted DB, then **`make db-sync-identity-secret`**, which sets `identity_sync.outbound_config.internal_secret` to **`DEV_IDENTITY_INTERNAL_INGEST_SECRET`** in the root `Makefile` (same value as `IDENTITY_INTERNAL_INGEST_SECRET` in `infra/dev/supabase/docker-compose.yml` → `functions`). Without that step, triggers do not call `identity_lifecycle_fanout` and mirrors (e.g. Author Payload) will not receive lifecycle events.

   **User lifecycle (create / update / delete):** Postgres triggers → Edge `identity_lifecycle_fanout` (Zod via `@workspace/domain-events`) → **NATS JetStream** only. **`nats`** runs in **root `infra/dev/docker-compose.yml`** (same **`proflow`** project as Supabase); Edge **`functions`** use `NATS_URL` → `nats://nats:4222` and mount **`packages/domain-events/dist`**. Put **`NATS_URL=nats://127.0.0.1:4222`** in **`apps/author/.env`**. **`bun run dev`** in **`apps/author`** (or monorepo **`bun run dev`** when Author is included) starts **Next** on **3002** and the **JetStream consumer** together. Use **`bun run dev:next`** or **`bun run identity:jetstream`** only if you need to split processes. **Public signup** also fires GoTrue `after-user-created`. Apply migrations (`make db-push`) for identity triggers + `user.updated` (`20260329120000_*`).
   - If you use only `SELF_HOSTED_DB_URL` (remote URL), `db-push` skips auto sync and prints a hint; run `make db-sync-identity-secret` yourself when the DB runs in local `supabase-db`.

3. **Optional:** restart PostgREST if you changed schema and REST still 404s: `docker compose -p proflow restart rest` in `infra/dev/supabase`.

## Storage / materials (section 8)

The current materials/storage MVP uses **Supabase Storage** with the `media` bucket created by the migration in `supabase/migrations/20260421141800_storage_buckets_media.sql`.

Current reset-mode contract:

- **Avatar uploads:** stored under `media/avatars/<user_id>/<filename>`.
- **Read policy:** public bucket URL via `/storage/v1/object/public/media/...`.
- **Write/delete policy:** limited by Storage RLS so authenticated users can manage only their own avatar folder.
- **Author media flow:** Payload `media` collection stores uploads in the same bucket under `media/spaces/<space_id>/author/...` via `@payloadcms/storage-s3`.
- **Current validation baseline:** Author media accepts `image/*`, `text/*`, `audio/*`, and `video/*`, capped at 5 MB via Payload upload config. The collection derives `mediaKind` and `deliveryMode` metadata (`inline` for image/text, `stream` for audio/video). Avatar flow remains image-only at the UI layer.
- **Space alignment:** Author media object keys now derive from the active tenant/space id. Scope-level sub-prefixes for richer materials remain future work.
- **Archives:** ZIP/tar/gzip uploads are explicitly rejected for now. Archive ingest and auto-unpack remain a separate future slice.

Local dev and hosted environments use the same app-facing env shape:

- `apps/platform/.env` uses `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for browser uploads.
- `apps/author/.env` may set `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and `S3_REGION`; otherwise Payload defaults `S3_ENDPOINT` to `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/s3`.
- `tests/e2e/.env` uses `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` for seeded-user setup and smoke assertions.
- No extra storage-specific app env vars are required for the avatar MVP.

CORS posture:

- In local self-hosted Supabase, Storage is already exposed behind the same `https://api.proflow.local` origin used by the apps.
- Keep browser and API origins explicit at nginx edge; if you tighten Storage CORS later, update the Supabase storage service config and validate browser uploads again.

Verification:

- Apply migrations with `make db-push` after a reset so the bucket and Storage policies exist.
- Run the focused smoke check from `tests/e2e`:

   ```bash
   bun run test:e2e:smoke:ni -- --grep "user can upload avatar"
   ```

That smoke flow now covers upload, persisted read after reload, remove, and persisted clear.

## Edge Functions: runtime vs function logs

Messages such as `wall clock duration warning` and `early termination has been triggered` are emitted by the **edge-runtime** process inside `supabase-edge-functions`, not by your Deno function source. You cannot prefix those lines from TypeScript.

To put a **single wall-clock timeline on every line** from that container (runtime + `console.log` from functions), read logs with Docker timestamps, for example from `infra/dev/supabase`:

```bash
docker compose -p proflow -f docker-compose.yml logs -f -t supabase-edge-functions
```

(`-t` adds the timestamp Docker attaches when it records each log line.) The Vector `docker_logs` source in this stack also carries container log metadata including time when events are shipped to analytics.

## Related docs

- `infra/dev/supabase/.env.example` — Supabase stack env (identity fan-out is hardcoded in `docker-compose.yml`). For **space invite magic links**, **`ADDITIONAL_REDIRECT_URLS`** must include your gateway origin + **`/platform/**`** (see example default); then restart **`auth`** in `infra/dev/supabase`.
- `infra/dev/supabase/README.md` — upstream-oriented Supabase compose notes
