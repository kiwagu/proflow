# Known issues and operational quirks

Short-lived notes on **expected-but-confusing** behavior in this repo. Prefer linking here from runbooks instead of duplicating long explanations in chat.

When something is fixed upstream or in-tree, **update or remove** the entry so this file stays trustworthy.

---

## Edge Functions: `wall clock duration warning` / `early termination has been triggered`

**What you see:** The `supabase-edge-functions` container prints lines like:

```text
wall clock duration warning: isolate: <uuid>
early termination has been triggered: isolate: <uuid>
```

often in **pairs per isolate**, sometimes **many UUIDs** after a single user action (e.g. creating a user in Studio).

**What it is:** These messages come from **Supabase edge-runtime** (the Deno worker supervisor), **not** from application code or `@workspace/logger`. They indicate the runtime is tracking or **tearing down isolates** (wall-clock / lifecycle policy). That is **not** the same as “your handler threw” or “HTTP 5xx,” though slow handlers can correlate with warnings.

**Bug or feature?** Treat as **runtime noise / operational detail**, not a product bug in our functions by itself. A definitive “bug” would be paired with **failed** deliveries (e.g. missing JetStream messages, 5xx from `pg_net`, broken consumers). For HTTP success + correct side effects, these lines are often **benign**.

**How to debug meaningfully:**

- Correlate with **Docker timestamps**: `docker compose … logs -f -t supabase-edge-functions` (see `infra/dev/README.md` → *Edge Functions: runtime vs function logs*).
- Use **application logs** from `@workspace/logger` (`requestId`, event, NATS steps) — those lines carry the real request timeline.
- Remember **multiple isolates** can reflect **multiple real HTTP calls** (DB triggers + hooks + `UPDATE`s on `auth.users`), not duplicate logging of one call. See `docs/cross-functional-checklist.md` section 5 (idempotency).

**References:** `infra/dev/README.md`, `.cursor/rules/supabase-identity-sync-author.mdc`, `packages/logger`.

---

## Author: upload from Payload admin does not complete

**What you see:** Uploading files from the Payload admin UI in `apps/author` does not complete successfully from the admin flow. In previous reproductions this surfaced as repeated requests around the media create/upload path instead of a normal one-shot completion.

**Current status:** This is still considered an active known issue. We upgraded Payload to `3.83.0` and removed the local `@payloadcms/ui` patch so behavior can now be re-verified against upstream more cleanly, but the repo should still be treated as having a broken admin upload flow until a browser re-test proves otherwise.

**What it is:** The strongest current suspicion is a Payload admin / form-state interaction in the upload flow rather than a basic S3 wiring failure. Upstream Payload has recent fixes around client uploads and storage prefixes, but we do not yet have a confirmed in-repo resolution for this exact admin-side symptom.

**Mitigation / how to verify:**

- Do not assume Author media uploads are working in local dev just because typecheck and import-map generation pass.
- Reproduce in the browser through `/author/admin` after starting the updated runtime.
- Inspect network traffic around `/author/admin/collections/media/create` and storage upload requests.
- If the issue is gone on `3.83.0`, remove or update this note immediately.

**References:** `apps/author/package.json`, `apps/author/src/payload.config.ts`, `apps/author/src/app/(payload)/admin/importMap.js`, `docs/cross-functional-checklist.md` section 8.

---

## Adding a new entry

Use this pattern:

1. **Title** — short, searchable.
2. **Symptom** — what people see (logs, UI, CLI).
3. **Explanation** — root cause or “unknown / upstream.”
4. **Mitigation / how to verify** — actionable.
5. **References** — files, issues, docs.
