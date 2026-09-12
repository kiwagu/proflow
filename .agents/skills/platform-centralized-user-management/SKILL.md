---
name: platform-centralized-user-management
description: Use when: adding or changing user tables, auth bridges, identity sync, or admin screens so Platform remains the single source of truth for user management.
---

# Platform — centralized user management

## Pyramid Layer

- Layer: L1 workflow.

## Use This When

- Start here when a task affects user lifecycle, mirrored user rows, auth bridges, or admin UX outside Platform.
- Use this skill to decide whether a change belongs to Platform only or to a read-only mirror path.

## Stop Here If

- Stop once the ownership decision and allowed write path are clear.
- Descend only if the task also needs the concrete repository rule or the identity mirror transport.

## Descend To

- Repository rule: `/.cursor/rules/platform-centralized-user-management.mdc`
- Identity mirror transport: `/.cursor/rules/supabase-identity-sync-author.mdc`

## Principle

- **One source of truth:** operators and approved product flows manage users **only from Platform** (`apps/platform` today). Other applications **do not** become a second place to create, edit, or delete accounts.
- **Mirrors everywhere else:** CMS collections, Drizzle tables, or other stores **reflect** centralized identity for login, FKs, and internal use — synced via the **identity pipeline**, not hand-edited in those UIs.
- Prefer standard patterns once the flow grows: adapters for mirror/write boundaries, policy objects for ownership rules, and strategy/registry seams for transport-specific sync logic instead of embedding all cases in one service or hook.

## Mirror apps with their own admin UI

Unless the PRD explicitly carves out an exception:

1. **Auth collection / user table**
   - `create` / `delete` → denied for normal requests (or stricter policy aligned with Product).
   - `read` → as needed for support (e.g. any signed-in admin can open user docs).
   - `update` → may be allowed for signed-in users **only** so the admin UI shows Save and editable fields; **block real persistence** from HTTP in `before`-change/-delete hooks unless the request context carries an explicit sync flag (a per-app constant in a `*.sync-context.ts`).
   - **Custom Save (or equivalent)** — do not submit; explain that management happens on the **Platform**.
   - **Admin copy** — state that editing happens on the Platform, not in this app.

2. **Trusted writes**
   - Identity fan-out, login bridge, and tests call the server-side API with access override and the **shared sync `context`** object — never omit the flag or hooks will block legitimate sync.

3. **Naming**
   - Per-app constants can keep an app prefix; the **meaning** is always “allowed because centralized sync / bridge authorized this write.”

## Other stacks (e.g. Drizzle + UI)

Apply the **same outcomes**, adapted to the stack:

- **No** operator CRUD for users in that app’s UI unless Platform remains authoritative and the write is delegated (rare; document if so).
- **Server-side** enforcement on mutations (middleware, service layer, DB triggers, or route guards) — not only hidden buttons.
- **Read-only or guided UX** when showing user rows (disable edits, modal copy pointing to Platform).
- Ingest updates **only** from the **central identity** path (events, jobs, signed internal APIs).

## Outbound email (invites, auth mail)

- **Do not** send SMTP from Platform or other shells. **SMTP and nodemailer** live in **`@workspace/notifications`**. **Every** email body must go through **React Email** (`packages/notifications/src/email/templates/*.tsx`) and **`renderEmail()`** — no hand-written HTML strings in consumers or services. The Bun process **`services/notifications`** runs HTTP, GoTrue hook, and **JetStream** consumers; it calls **`renderEmail`** + transport from the package.
- Space invites: **`apps/platform`** (after `rpc_create_space_invite`) → JetStream → **`services/notifications`** consumer → **`renderEmail(locale, { templateKey: 'space_invite', data })`** → SMTP (`NATS_URL` on platform + notifications-service). See `.cursor/rules/notifications-central-email.mdc`.

## Do not

- Add parallel “user admin” in a mirror app or a Drizzle admin without an explicit product decision.
- Re-enable arbitrary user CRUD via feature flags without sign-off.
- Skip sync context / trusted-channel flags on any intentional write to mirrored user rows.

## Environment variables

- Prefer **one name per concept** across the monorepo (e.g. `GATEWAY_ENTRY_ORIGIN` for public URLs). Add a new env key only when **two or more** components must share it or a central settings layer will supply it — see `.cursor/rules/monorepo-env-minimalism.mdc`.

## Related skills

- `nextjs-shell-supabase-auth` — shell proxy and guest policy
- Shared contracts: `packages/domain-events` (Zod + NATS subject helpers); Edge: `infra/dev/supabase/volumes/functions/identity_lifecycle_fanout`
