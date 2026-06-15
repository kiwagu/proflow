# Cross-functional backlog checklist

Monorepo-wide capabilities that span apps (`apps/platform`, `apps/author`, `apps/web`, Edge, services) and shared packages. Use this as a planning surface; link PRs and ADRs when work starts.

**See also:** [`docs/known-issues.md`](./known-issues.md) — operational quirks (e.g. edge-runtime log noise vs application logs). [`docs/cross-functional-checklist-phase-2.md`](./cross-functional-checklist-phase-2.md) — second-priority cross-cutting ideas (observability, scaling, S2S auth, etc.), for memory only. [`docs/cross-functional-checklist-phase-3.md`](./cross-functional-checklist-phase-3.md) — deferred items from space-isolation planning (extended ops, rate limits, GDPR-style lifecycle, optional JWT `space_id`, etc.). [`docs/feature-management-model.md`](./feature-management-model.md) — source of truth for feature-flag ownership, resolution, and admin boundaries.

## How to use

- Keep items **action-oriented** (outcome + rough approach), not app-specific tickets unless blocking everyone.
- When an item ships, move details into the relevant package README, Cursor rule, or runbook and trim this file.
- **Order:** sections follow **implementation priority** (dependencies first). **Custom entity IDs** (**section 1**) are the **shared primary-key shape** for new domain rows. **Space isolation** (**section 2**) is the **outer data boundary**: resolve **active Space** before **RBAC** and enforce **`space_id`** (organizations group spaces; see **section 2**). Then **RBAC**, unified membership/resources, idempotency, runtime settings (critical-capability-gated **super-admin path**, **section 4b**), feature management (**section 6a**), i18n, **materials**, and **audit log** (section 9). Storage paths follow the same **space** key as **section 2**.

---

## 1. Custom entity IDs (prefix + ULID payload, DX-first)

**Problem:** Ad-hoc **UUIDs everywhere** or **serial integers** make logs, URLs, and cross-service references opaque; integers do not encode **entity type**, and random-only strings do not give a **stable global sort order** for list APIs. A single **human-readable, parseable** format shared across **Postgres, Edge, Next, and workers** avoids drift.

**Current direction (implemented):** A canonical string format plus one contract, with implementations in TypeScript/Bun and Postgres. Edge does **not** mint IDs; it only publishes lifecycle events.

1. **Alphabetic prefix** per entity type (short, fixed catalog), e.g. `usr` (user), `prfl` (profile), `spc` (space).
2. **First separator** after the prefix: **`_`** (underscore).
3. **Entropy segment (`rand`)**: 16 chars, ULID randomness segment (80 bits), Crockford Base32.
4. **Second separator:** **`.`** (dot).
5. **Time segment (`ts`)**: 10 chars, ULID time segment (48 bits, milliseconds since Unix epoch), Crockford Base32.

**Canonical shape:** `<prefix>_<rand16>.<ts10>` (e.g. `usr_mkg2pqwyacy14bym.01kn21dwmd`).

**Notes:**

- ULID equivalence: `ulid = <ts><rand>` (26 chars, canonical uppercase).
- Sorting: do **not** `order by entity_id` for recency (DX-first format puts `rand` before `ts`). Use `created_at` for list APIs; if needed, extract and sort by `ts`.
- Source of truth for user `entity_id`: `public.profiles.entity_id` (not `auth.users.id`), propagated via JetStream identity lifecycle events.

**Contract + implementations:**

- TypeScript/Bun: `packages/entity-id` (Zod validation + branded `EntityId`, parsing, ULID conversion, CLI).
- Postgres: `public.entity_id_generate(prefix text)` (migration) for DB-native defaults.

**Checklist:**

- [x] **Spec:** alphabet (ULID Crockford Base32), lengths (`rand16`, `ts10`), max length, normalization rules, and sorting guidance documented in `packages/entity-id/README.md`.
- [x] **Implementations:** TypeScript/Bun (`packages/entity-id`), Postgres generator (`public.entity_id_generate(...)`). Edge publishes events and does not mint IDs.
- [x] **Rollout:** `public.profiles.entity_id` as canonical user id; identity lifecycle events carry `entity_id`; Payload mirror uses string `_id` for users.
- [x] **Tests:** parse/normalize, ULID round-trip, prefix tools, Zod validation, time extraction helpers.

**References:** sections 2–4 (space isolation, RBAC, unified model); index strategy for `TEXT` PKs.

---

## 2. Space isolation (organization + Space, boundary and resolution)

**Problem:** If **which Space owns a row** is implicit or inconsistent, each feature reinvents host or path hacks, **cross-space leaks** become likely, and **RLS**, **storage prefixes**, and **RBAC** cannot share one rule.

**Likely direction:** Two layers: **`organization`** (Enterprise grouping, billing, org-admin scope) and **`space`** as the **data isolation boundary**. **Strict 1:N:** each **Space** belongs to **exactly one** organization; **no** many-to-many between Space and organization. **`space`** is a **first-class row** with stable **id** (and optional slug for URLs). **Resolve active Space once per request**—cookie, optional query, subdomain, path—**checked** against the user’s **space memberships** so arbitrary `space_id` cannot be injected. **Space-scoped tables** use **`space_id` NOT NULL** and **composite indexes** `(space_id, …)`; **RLS** (or strict server enforcement **plus** RLS) filters every access by that key. **Platform-global** rows (e.g. defaults editable only via the critical-capability-gated **super-admin** path in **sections 3 and 4b**) omit Space or use **`space_id` null** only where explicitly documented. **Section 3** **`user_role`** carries **`space_id`** when roles are **per-space**. **Sections 4 and 8** reuse the **same** space key for resources and object paths.

**Checklist:**

- [x] **Organization + Space entities:** migrations (`organizations`, `spaces`, `organization_memberships`, `space_memberships`), seed (two orgs + two spaces), and `rpc_bootstrap_organization_and_space` for first-time provisioning (`apps/platform` onboarding).
- [x] **Membership:** `space_memberships` links `auth.users` to `spaces` with `active|invited|suspended`; `organization_memberships` carries `org_admin|member`.
- [x] **Request context:** `resolveActiveSpaceDecision` in `@workspace/gateway-auth`, httpOnly cookie `pf_active_space_id`, optional `?space=<slug>`; **Platform** `lib/active-space.ts` enforces membership before trusting context; `ActiveSpaceProvider` client context; skip paths for `/invite`, `/auth`, `/onboarding`, `/profile`, `/organizations`.
- [x] **Product UX (core):** **0 / 1 / N** → onboarding (`/onboarding`), picker (`/spaces/select`), cookie + query redirect strip; `/profile` gate when user has org or pending invite but no active space.
- [x] **Space invites:** `space_invites` table (token, TTL 30 d, `pending|accepted|revoked|expired`), three security-definer RPCs (`rpc_create_space_invite`, `rpc_accept_space_invite`, `rpc_revoke_space_invite`); 3-phase accept flow (`/invite/start` → auth/password → `/invite/accept`); org-admin invite management UI per space (`space-invite.manager.client.tsx`); space switcher shows pending invites with accept action.
- [x] **Space admin role:** `auth_user_is_space_admin` / `auth_user_can_manage_space_invites` helper functions; `space_memberships` INSERT policy extended so space admins can add `authed`-role members only (prevents privilege escalation); `platform-space-admin.ts` queries.
- [x] **Invite notifications:** [`SpaceInviteEmail`](../packages/notifications/src/email/templates/SpaceInviteEmail.tsx) React Email template (i18n); invites enqueue into `public.outbox_jobs` inside `rpc_create_space_invite`, and [`outbox-worker.ts`](../services/notifications/src/outbox-worker.ts) claims/delivers email idempotently. Reset-mode keeps this as the only path.
- [x] **Light audit trail (before full section 9):** `public.space_admin_audit_log` + bootstrap audit row; Postgres triggers fan out lifecycle to Edge (see below).
- [x] **Role tests:** `packages/gateway-auth` unit tests for resolver; `apps/platform/tests/rbac.super-admin-org-admin.test.ts` documents critical-capability-gated **super-admin** vs **org_admin** expectations (full DB allow/deny tests need live Supabase).
- [x] **RLS:** policies on org/space/membership tables; `space_invites` RLS (invitee sees own by email claim, managers by space permission, mutations via RPC only); cross-space leak tests are **skipped** until CI runs against a seeded Supabase (`apps/platform/tests/rls.cross-space.test.ts`).
- [x] **E2E tests (invite):** `platform-space-invite.e2e.spec.ts` — invalid token error page, org-admin creates pending invite; `platform-org-bootstrap.ts` helper for test setup/teardown.
- [x] **E2E tests (space isolation):** `platform-space-isolation.e2e.spec.ts` — **@smoke:** cross-space SELECT blocked (memberships, spaces, orgs, invites RPC); **full:** bidirectional RPC deny (create/revoke invite cross-space), email-mismatch accept blocked, privilege escalation (space_admin cannot grant admin role), direct DML blocked (INSERT/UPDATE/DELETE on foreign space memberships); `space-isolation-bootstrap.ts` provisions two isolated tenants with anon-key authenticated clients for real RLS coverage.
- [ ] **Align downstream:** **section 3** `user_role`, **section 4** resources, **section 8** storage prefixes—wire to `space_id` as those tracks land.
- [x] **Author (Payload):** [`@payloadcms/plugin-multi-tenant`](https://payloadcms.com/docs/plugins/multi-tenant) with `tenantsSlug: 'spaces'`; mirror collections `organizations` / `spaces`; UI writes blocked except JetStream sync context.
- [x] **Org/Space lifecycle → Author:** [`@workspace/domain-events`](../packages/domain-events) `space_org.lifecycle.v1.*` subjects, Edge `space_org_lifecycle_fanout`, consumer [`space-org.jetstream.worker.ts`](../apps/author/src/identity/space-org.jetstream.worker.ts) applies [`space-org.lifecycle.apply.ts`](../apps/author/src/identity/space-org.lifecycle.apply.ts).

**References:** section 3 (RBAC); section 4 (unified model); `apps/web`, `packages/gateway-auth` (routing / forwarded headers); identity sync rule (JetStream pattern). Deferred hardening: [`cross-functional-checklist-phase-3.md`](./cross-functional-checklist-phase-3.md).

**Note:** In reset-mode, this path is greenfield migrations + seed only.

---

## 3. RBAC: roles, permissions, and assignments

**Problem:** Without a **shared role and permission model**, every feature invents ad-hoc checks (`if admin`) and **global operator actions** (e.g. default platform language) have no single gate. The same account may hold **multiple roles** (e.g. tutor and student); effective capability must be **explicit, seedable, and extensible** without conflating tenant-local administration with platform-wide operator powers.

**Likely direction:** **Postgres tables:** `roles`, `permissions`, `role_permission`, `user_role`, with one role model split into three classes: **baseline system roles** (immutable defaults such as `org_admin`, `space_admin`, `member`), **additional global system roles** introduced only by **super-admin**, and **organization-scoped custom roles** composed by **org-admin** from the fixed permission catalog. **Effective permissions** for a user = **union** of permissions from all assigned roles in the relevant scope, with **`space_id` on `user_role`** for space assignments and organization ownership on custom-role definitions (**section 2**). Critical global access remains an **exception path**: private capability checks with short-lived break-glass sessions and audit-only visibility, implemented via one centralized helper (no duplicated `if role === ...` checks). **All regular** authorization uses **`permission`** checks derived from the tables (or helpers built on them), not string compares on role names in business logic. Because the stack is always recreated, the RBAC schema and policies may be rewritten directly without compatibility fallbacks.

**Checklist:**

- [x] **Schema:** `roles`, `permissions`, `role_permission`, `user_role`; baseline system roles seeded by default, additional global system roles managed only by **super-admin**, organization-scoped custom roles owned by one organization, and **`permission` key** naming documented (e.g. `settings.global.write`).
- [x] **Multi-role:** multiple assignments per user **per space** where needed; define **union** semantics across baseline system roles, super-admin-managed global system roles, and org-scoped custom roles; optional UX for “active context” if product needs it.
- [x] **Critical capability gate:** single module listing allowlisted global operations; use private/JIT capability checks and wire **section 6** global mutations through it.
- [x] **Helpers:** shared `hasPermission(user, key, scope?)` (and variants); **deny by default** when data is missing.
- [x] **Binding:** tie `user_role` to **Supabase `user.id`**; align bootstrap/revocation with identity lifecycle and **section 2** space membership.
- [x] **Tests:** allow/deny matrix from seed data for baseline system roles, super-admin-managed global system roles, and representative org-scoped custom roles; see [`docs/rbac/role-permission-test-matrix.md`](./rbac/role-permission-test-matrix.md).

**References:** section 2 (space isolation); section 4 (membership and resources); section 6 (settings + critical capability); `packages/gateway-auth`; identity JetStream events.

---

## 4. Unified model for users, membership, and resources

**Problem:** **Supabase Auth** answers **authentication** (identity, session). Product behavior also depends on **who belongs where** and **which resources sit in which scope**—often modeled piecemeal per app or table. Without **one coherent picture**, rules contradict each other, migrations drift, and Platform, Author, APIs, and future shells each re-derive access differently.

**Likely direction:** **Unify** identity-adjacent and authorization-relevant entities in a **single, non-contradictory domain model** backed by **Postgres** (migrations, foreign keys, invariants), **scoped by `space_id` from section 2** where data is not platform-global. The model is expressed **SQL-first** — hand-written migrations, entity-id PKs, foreign keys, and RLS as the single schema story everyone reads. Prisma and ORM-owned schemas are explicitly rejected: an ORM connecting under an owner role silently bypasses RLS unless every query sets the request role, which conflicts with RLS-as-sole-access-authority. Query-building DX (declarative, GraphQL-like) is served in-stack by **`pg_graphql`** and the **PostgREST** builder, both RLS-aware. A recurring shape—**not tied to a single vertical**—is **user → membership / role-in-context → group or scope → resource** (document, asset, dataset, deliverable, etc.). Treat **identity account lifecycle** and **domain user lifecycle** as distinct concerns: identity is centralized, while domain user state in a Space is managed through section 3 permissions and `space_id` boundaries. **Evaluate access** with **narrow queries** (joins/exists), **RLS** where data lives in Supabase, **section 3** for **permission** and **section 2** for **Space**, and **shared server helpers** so Route Handlers, server actions, Payload access, and services do not fork the same logic.

**Checklist:**

- [x] **Model:** one **SQL-first Postgres** design (hand-written migrations, entity-id PKs, RLS — no ORM) for organizations, spaces, groups/scopes, resources, and **join tables** linking users to scopes and resources to scopes—each row **space-scoped** per **section 2**; add **indexes** for hot paths (membership lookup, resource-by-scope).
- [x] **Binding:** map **Supabase `user.id`** to person/operator rows; **bootstrap** on `user.created`, **revoke or archive** links on `user.deleted`, **updates** when roles or memberships change (Platform admin API and/or identity-driven workers).
- [x] **Consistency:** decide **write path** (admin API, transactional updates) and expectations for **read-after-write** in admin UX; align **RLS** with the same invariants where data lives in Supabase.
- [x] **User management boundary:** document and enforce which user operations are identity-level versus domain-level; allow space-admin CRUD on domain users only within their `space_id` and granted permissions from section 3.
- [x] **Enforcement:** shared helpers for **“can this user access this resource?”** and **batch list filters** (avoid N+1); combine **sections 2–3** (space + permissions) with scope/membership joins; **deny by default** on ambiguous or missing membership; document any **break-glass** behavior if a dependency is down.
- [x] **Dev/prod:** migrations + seed data for realistic chains; CI or tests that assert **allowed vs denied** paths for representative roles.
- [x] **Access audit (lightweight):** who can create or change memberships and resource links; optional logging of **denied** access attempts for security review.

**References:** sections 2–3 (space isolation + RBAC); `packages/gateway-auth`, `apps/platform` (admin user management skill); Postgres RLS and migration rules in-repo; identity JetStream events for lifecycle-driven membership updates.

---

## 4a. Org-admin UI contour for org-scoped RBAC and delegated domain user management

**Problem:** Even with a correct backend RBAC model, operators need a clear and constrained UI to manage organization-owned custom role bundles, scoped assignments, and delegation boundaries. Without a dedicated contour, teams fall back to ad-hoc scripts and inconsistent admin actions, while org-level custom roles and global system roles risk being conflated.

**Likely direction:** Add a dedicated **Platform org-admin UI** as a separate delivery track from section 3 schema work. The UI manages **organization-scoped custom roles** composed from the fixed permission catalog, permission bundles, and user-role assignments inside the organization’s spaces. Delegated **space-admin** domain user management (`create`, `read`, `update`, `delete`) is allowed only within the current `space_id` and only for permissions granted by **org-admin** policy. **Global system roles** are explicitly out of scope for 4a and belong to **section 4b**. All new Platform admin UI in this track should launch with ICU-based i18n (`en` default/fallback, `es` initial). Because the stack is always recreated, this track may rewrite current migrations and app paths directly without compatibility fallbacks.

**Checklist:**

- [x] **Org-admin console:** one UI surface to manage organization-scoped custom roles, permission bundles, and user-role assignments per organization/space.
- [x] **Delegation boundaries:** explicit policy UI for what space-admin can do on domain users; deny by default outside granted permissions.
- [x] **Scoped user management:** enforce that space-admin CRUD applies only to domain users inside active `space_id`, never cross-space.
- [x] **Role separation:** keep baseline system roles immutable and exclude global system-role management from the org-admin contour.
- [x] **Runtime write validation:** validate all mutating payloads at server boundaries (**Route Handlers**, server actions, workers, and mutating RPC entry points) before any DB write (`insert` / `update` / `delete` / mutating RPC); reject unknown fields and invalid scope identifiers (`space_id`, `organization_id`, role IDs), then rely on RLS as the final enforcement layer.
- [x] **Operational safety:** transactional writes, optimistic UI feedback, and audit emission for role and user-management mutations.
- [x] **i18n from day one:** all new admin UI strings ship through the shared ICU-based translation layer with `en` fallback and `es` support.
- [x] **Tests:** end-to-end allow/deny scenarios for org-admin delegation and space-admin domain user CRUD within scope.

**References:** section 2 (space isolation), section 3 (RBAC core), section 4 (unified user/resource model), section 4b (super-admin/global system roles), section 9 (audit log), `apps/platform`.

---

## 4b. Super-admin interface, critical-capability entry, and global system-role management

**Problem:** Platform-wide operator actions need an explicit, auditable surface separate from tenant administration. Without a dedicated super-admin contour, cross-organization remediation, privileged access, and introduction of new global system roles become opaque and unsafe.

**Likely direction:** Add a dedicated **Platform super-admin UI** gated by the existing critical-capability path centered on `platform.admin.override`. This surface owns privileged operator entry, cross-organization inspection, emergency remediation, and management of **global system roles** composed from the fixed permission catalog. These roles are distinct from organization-scoped custom roles in **section 4a** and should be managed only from the super-admin contour. Because the system is still pre-production and the stack is always recreated, migrations and app paths in this track may be rewritten directly without compatibility shims.

**Checklist:**

- [x] **Super-admin entry/auth:** route entry, session gating, and navigation visibility based on the critical-capability path, not on a persistent super-admin role.
- [x] **Global system-role catalog:** one UI surface for introducing and managing additional global system roles from the fixed permission catalog.
- [x] **Cross-org operations:** operator views and actions for inspection, remediation, and support across organizations/spaces.
- [x] **Privilege boundaries:** keep super-admin global role management separate from org-admin custom-role management.
- [x] **Operational safety:** transactional writes, explicit confirmation UX for high-risk actions, and audit emission for every privileged mutation.
- [x] **Tests:** allow/deny scenarios for critical-capability entry, global system-role creation, and privileged cross-org actions.

**References:** section 3 (RBAC core), section 4a (org-admin contour), section 6 (global settings), section 9 (audit log), `apps/platform`, `packages/rbac/src/critical-capability.ts`.

---

## 5. Idempotency for side effects (notifications, mirrors, welcome flows)

**Problem:** Identity and auth fan-out can emit **multiple** correlated events per user action (e.g. `user.created` from DB trigger + GoTrue hook; multiple `user.updated`). Consumers that send email or mutate state on every message risk **duplicates** unless they dedupe.

**Current direction:** `public.outbox_jobs` is the canonical dedupe ledger for notification side effects. DB-owned flows (for example `rpc_create_space_invite`) enqueue intent in the same transaction as domain truth; external flows (for example GoTrue `send_email`) enqueue with a stable natural idempotency key before delivery. `pgmq` owns the low-level queue visibility / retry transport, while workers still complete or retry business jobs through the outbox RPC surface.

**Checklist:**

- [x] Define **idempotency keys** per event type (invite email: `notify:space-invite-email:<invite_id>`; GoTrue auth email: `gotrue:send-email:<user_id>:<action>:<token_hash>`; mirror upsert remains keyed by stable Supabase user IDs in consumers).
- [x] Choose outbox storage (Postgres `public.outbox_jobs`) and **delivery** mechanism (service-role polling worker using `pgmq` transport behind claim/complete/retry RPCs).
- [x] Align **notifications** (`@workspace/notifications`, hooks, workers) so active sends are not triggered only by “raw stream duplicate” without a dedupe gate.
- [x] Document behavior for **identity lifecycle** (`docs/`, identity sync rule) — operators should expect multiple stream messages; consumers must be safe.

**References:** `packages/domain-events`, Author JetStream worker, `supabase-identity-sync-author` Cursor rule.

---

## 6. Global runtime settings (runtime log level, platform language)

**Goal:** Central **operator-facing** and **runtime** configuration for settings that behave like runtime defaults: e.g. **log level** for Edge and Node services and **default platform locale** — without redeploying everything for every tweak.

**Likely direction:** **Mutations** that change **global** defaults (e.g. system-wide default language) go through the **section 3** critical capability allowlist and the **section 4b** super-admin contour only (private + JIT + audit); other settings may use normal **`permission`** keys from RBAC. **Space-scoped** settings (if any) use **`space_id`** per **section 2**. Feature flags are intentionally split out into **section 6a** because their ownership and rollout model no longer matches generic runtime settings.

**Checklist:**

- [x] **Logging (runtime level):** persist desired `LOG_LEVEL` in the **settings store** and expose **Platform admin** control to apply it through `@workspace/logger` `setLogLevel()`.
- [x] **Platform language / locale default:** store defaults in the same runtime settings hierarchy and link them to the i18n resolution order (**section 7**). Broader i18n rollout beyond Platform continues in **section 7**.
- [x] **Auth + RLS:** who reads/writes settings (service role vs operator roles); **global** writes gated by the section 3 critical capability helper and the section 4b super-admin contour; audit trail for changes.

**References:** sections 2–3 (space isolation + RBAC / critical capability); section 7 (i18n); `@workspace/logger`, `@workspace/settings-runtime`, `infra/dev/supabase/.env.example` (`LOG_LEVEL`), future admin routes on Platform.

---

## 6a. Feature management and rollout controls

**Goal:** Separate **feature availability policy** from generic runtime settings so product rollout stays organization-owned, auditable, and explicit about who can activate a feature for which spaces.

**Likely direction:** Treat feature flags as a dedicated control plane, not as a free-form extension of runtime settings. The **global** layer defines the default baseline for newly created organizations; ongoing rollout inside an organization is **organization-owned**. **Org-admin** and **super-admin** may manage feature availability for spaces through organization-scoped flows. **Space-admin** gets visibility into effective feature state but no write path. See [`docs/feature-management-model.md`](./feature-management-model.md) for the full model.

**Checklist:**

- [x] **Separate source of truth:** keep the ownership, resolution, and UI model in [`docs/feature-management-model.md`](./feature-management-model.md) and update implementation against that document.
- [x] **Typed keys per feature:** keep one **typed boolean key per feature**. Initial flag: **`platform.feature_flag.organization_settings`**; avoid free-form JSON blobs and scattered `process.env` checks for product behavior.
- [x] **Bootstrap from global defaults:** use **global** feature values only as the template inherited by newly created organizations; after bootstrap, ongoing rollout becomes organization-owned.
- [x] **Organization-owned rollout:** add org-level controls for per-space activation/deactivation and organization-wide bulk deactivation.
- [x] **No space bypass:** enforce that a space cannot bypass an organization-layer disable; **space-admin** may inspect effective state and source only.
- [x] **Auth + audit:** every feature-flag mutation must record actor, target organization, optional target space, previous value, and new value; privileged flows stay under the section 3 critical-capability and section 4b super-admin boundaries where applicable.

**References:** sections 2–4b (space isolation, RBAC, admin contours); section 9 (audit log); [`docs/feature-management-model.md`](./feature-management-model.md); `@workspace/settings-runtime`.

---

## 7. Global i18n for user-facing UI

**Goal:** One shared catalog and enforcement model for customer-facing surfaces (Platform shell, Author admin, notifications email), with surface-specific loading and locale resolution where framework/runtime constraints differ.

**Checklist:**

- [x] Pick one stack compatible with **Next.js App Router** and **React Email**. Current choice: centralized JSON catalogs plus lightweight ICU-style runtime formatting in app code and email rendering.
- [x] Keep one **source of truth** for messages in `packages/i18n-catalogs/src/catalogs/<domain>/` instead of per-app message ownership.
- [x] Standardize locale handling by contract: Platform resolves locale from user settings, cookie, scope settings, `Accept-Language`, then EN fallback; Author keeps Payload-local materialization as an intentional config-time exception; notifications normalize locale input and render from the shared catalogs.
- [x] Keep shell routing aligned with gateway `basePath`, but do **not** require locale URL prefixes or subdomains in the current architecture. Locale persistence is cookie/profile/header based.
- [x] Add **lint/checks** so user-visible strings and catalogs stay enforced: literal-key linting plus catalog validation for EN/ES parity, flat dotted keys, and non-empty string values.
- [x] Wire **notifications** templates to the shared locale catalogs and initialize catalog loading before worker-driven email rendering.

**Architecture note:**

- Platform lazily loads only the active locale catalog for space-settings and falls back to EN only when that catalog is already available.
- Author still materializes both locales during Payload config startup because Payload i18n expects translations at config-build time.
- Notifications now lazy-load catalogs on demand, but eagerly initialize supported locales during service startup so email rendering does not fall back to raw key ids.
- Validation lives in `@workspace/i18n-catalogs`: `bun run --cwd packages/i18n-catalogs validate`, package lint, and package `test:vitest`.

**References:** `packages/ui`, `apps/platform`, `apps/author`, `@workspace/notifications`, `packages/i18n-catalogs`, `@workspace/settings-runtime`; section 6 for default locale storage.

---

## 8. Materials, uploads, and object storage

**Problem:** **Files** (avatars, documents, media) are easy to implement **one-off per screen**, which duplicates presign logic, bucket layout, validation, and access checks across Platform, Author, and future apps. There is no shared story for **who may upload**, **where objects live**, and **how delivery expectations** stay consistent across top-level uploads.

**Likely direction:** Implement uploads on **Supabase Storage** (**buckets**, policies, and project conventions)—not a separate ad-hoc object store unless requirements change. Pair buckets with **DB rows** for metadata and scope where needed. **Server actions, Route Handlers, or Supabase client flows** enforce size/MIME limits and align with **section 4** resource scope, **section 3** permissions, and **section 2** space path prefixes. **Profile avatar** is one **illustrative** early slice (attach/replace/remove, public or signed reads, link to **`user.id`** or profile)—the same pattern should cover **text, audio, and video** for ordinary top-level media resources.

**Checklist:**

- [x] **Example slice (e.g. avatar):** **profile (or org) image** — upload/replace/delete on a **Supabase bucket**, optional resize or format normalization, **public vs signed** read policy, path convention, and DB field or sidecar row; same pattern reusable across **Platform** and other shells—avatar is **not** the only use case.
- [x] **Supabase buckets + policies (baseline):** bucket layout, **Storage RLS / policies**, and documented upload flows now exist for the avatar slice (`media/avatars/...`) and Author Payload media (`media/spaces/<space_id>/author/...`), including image-only MIME/file-size limits for the current Author upload contract.
- [x] **Space-scoped storage path alignment:** Author media now derives object prefixes from the active tenant/space boundary (`media/spaces/<space_id>/author/...`) instead of the previous shared `author/...` prefix; scope-level sub-prefix refinement can remain incremental.
- [x] **Media types (baseline):** Author media now accepts `text/*`, `audio/*`, and `video/*` in addition to images, validates against explicit MIME families, and derives `mediaKind` plus a baseline delivery shape (`inline` for text/image, `stream` for audio/video).
- [x] **Dev/prod:** Supabase **bucket** config in self-hosted or hosted projects, CORS if needed, env templates, and minimal **e2e or smoke** for upload + read + delete.

**References:** [Supabase Storage](https://supabase.com/docs/guides/storage) (buckets, access control); sections 2–4 (space + permissions + unified resource model); gateway and shell auth for who may mutate uploads.

---

## 8a. Archives ingest pipeline

**Problem:** Archives are not just another media type. They may represent a single opaque upload, or a container that should be inspected, optionally unpacked, and exposed as child artifacts. Treating archives as ordinary files conflates two different product decisions: **store-as-is** versus **ingest-and-expand**.

**Likely direction:** Keep archive handling as a separate pipeline from the ordinary media flow in **section 8**. The first product decision should be explicit per flow: whether a given archive upload should remain a single stored object or go through **optional** unpack/ingest. If unpack is enabled, the pipeline should inspect the archive, enforce limits, create child artifact metadata, and keep the resulting objects under the same access boundary as the parent upload. If unpack is disabled, the archive should remain an opaque file with no implicit extraction.

**Checklist:**

- [x] **Archive guard (baseline):** archive MIME types such as ZIP/tar/gzip are explicitly rejected by the current media contract instead of being accepted implicitly with undefined behavior.
- [ ] **Archive mode selection:** define the product-level contract for archive uploads: store-as-is, unpack, or selectable per request/use case.
- [ ] **Archive ingest + optional unpack:** when enabled, unpack archives into addressable child artifacts under the same access model as the parent.
- [ ] **Safety limits:** enforce size, depth, inner-type allowlists, idempotent re-ingest behavior, quota accounting, and zip-bomb posture.

**References:** section 8 (ordinary media flow); sections 2–4 (space + permissions + unified resource model).

---

## 9. Audit log (security-sensitive and admin actions)

**Problem:** **Who changed what** (roles, space membership, global settings, billing-related data) is hard to reconstruct from application logs alone. Without a **durable audit trail**, incident response, compliance questions, and operator trust suffer.

**Likely direction:** **Append-only** (or insert-only) **audit log** in Postgres or stream to long-term storage: **actor** (`user.id` or service principal), **`space_id`** when applicable, **action** (stable string, e.g. `role.assign`, `settings.global.update`), **resource** type + id, **timestamp**, **request/correlation id** if available; optional **before/after** payload or hash for tamper-evidence. **Emit** from centralized helpers (after **sections 2–3** succeed), not scattered `console.log`. **Read path:** restricted to critical-capability-gated **super-admin** and/or space-scoped **admin** per **sections 3 and 4b**; define **retention** and whether exports are required.

**Checklist:**

- [ ] **Schema / storage:** table or dedicated store; indexes for query by **space**, **actor**, **time**, **action**; immutability policy (no updates/deletes for normal roles).
- [ ] **Instrumentation:** wrap **role/membership** mutations (**sections 3–4**), **global settings** writes (**section 6**), **space** lifecycle (**section 2**), and other high-risk operations behind a single **`audit.record(...)`** (or equivalent).
- [ ] **PII / secrets:** never log raw tokens or passwords; redact or hash where needed.
- [ ] **UI or API:** minimal **viewer** for operators with correct permissions; document **retention** and backup.

**References:** sections 2–4, 6 (RBAC, space isolation, membership, settings); `@workspace/logger` for operational logs (audit is separate from debug/app logs).

---

## Meta

| Area            | Owner(s) hint        | Notes |
|-----------------|----------------------|--------|
| Entity IDs      | Platform + shared package | section 1: prefix `_` entropy `.` monotonic; one spec, multiple runtimes |
| Space isolation | Platform + DB + gateway | section 2: organization + Space rows, resolution, RLS; prerequisite for scoped RBAC and data |
| RBAC            | Platform + shared package | section 3: three-layer role model (baseline system, global system, org-scoped custom) plus critical capability allowlist |
| Identity stream | Platform + DB + Edge | section 5: idempotency critical for consumers |
| Notifications   | notifications-service + templates | Overlaps outbox + i18n |
| Gateway / shells | `apps/web` + gateway-auth | Locale + base paths; space / org routing as product requires |
| Authorization   | Platform + shared policy package | sections 2–4: space + permissions + Postgres membership/resources; RLS + shared checks; identity events |
| Admin UX (RBAC/users) | Platform | sections 4a–4b: org-admin custom-role and delegated domain-user management; super-admin critical-capability entry and global system-role management |
| Domain / resources | Platform + DB | section 4: unified membership + resource graph; SQL-first |
| Global settings | Platform + admin | section 6: persisted runtime config; global mutations via critical capability gate (**section 3**) and super-admin contour (**section 4b**) |
| Feature management | Platform + org-admin contour | section 6a: organization-owned rollout model; global defaults seed new organizations only |
| i18n            | Platform + `@workspace/ui` | section 7: locale strategy; default locale from **section 6** where stored |
| Materials / storage | Platform + shared upload package | section 8: **Supabase Storage** buckets; avatar as one example; align with sections 2–4 |
| Audit log       | Platform + security | section 9: append-only admin/security trail; not the same as app debug logs |
| Phase 2 (memory) | — | [`cross-functional-checklist-phase-2.md`](./cross-functional-checklist-phase-2.md) — observability, scaling, S2S, quotas, etc. |
| Phase 3 (memory) | — | [`cross-functional-checklist-phase-3.md`](./cross-functional-checklist-phase-3.md) — deferred from space rollout: extended ops, rate limits, GDPR-style lifecycle, optional JWT `space_id`, etc. |

Add rows as new cross-cutting themes appear.
