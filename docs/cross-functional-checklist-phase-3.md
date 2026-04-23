# Cross-functional checklist — phase 3 (memory)

**Purpose:** Items that were **deferred** from the active space-isolation implementation plan and from immediate scope in [cross-functional-checklist.md](./cross-functional-checklist.md). Use as a **reminder surface**; promote into the primary checklist or into execution plans when they become active work.

**Relationship to phase 1 (primary):** [cross-functional-checklist.md](./cross-functional-checklist.md) — sections 1–9 (entity IDs, space isolation, RBAC, unified model, idempotency, settings, i18n, materials, audit).

**Relationship to phase 2:** [cross-functional-checklist-phase-2.md](./cross-functional-checklist-phase-2.md) — observability, scaling, S2S, quotas, etc. **Phase 3** is a **second deferral bucket**: items suggested during space-isolation planning that are **not** in the current rollout slice (including optional hardening not required for POC).

**Planning note:** RBAC backend core (section 3 in the primary checklist) and org-admin UI contour are tracked as separate points. UI for RBAC/user delegation belongs to primary checklist section **4a**, not section 3 backend migration scope.

---

## Observability and operations (extended)

- **Structured context everywhere:** propagate **`requestId`**, **`space_id`** (when resolved), **`organization_id`** (when relevant), and **`user.id`** into app logs across Next shells, Bun workers, and Edge — extends **section 9** vs **operational** logging (`@workspace/logger`; see primary checklist and `known-issues.md`).
- **Metrics and tracing:** RED/USE per service; **OpenTelemetry** (or equivalent) with shared trace id from gateway through workers.
- **Health vs readiness:** separate **liveness** and **readiness** for orchestration (DB, NATS, critical deps reachable) when running **multiple instances** behind a load balancer.

---

## Async messaging and workers

- **Retries and DLQ:** max retries, **dead-letter** stream or queue, alerting on DLQ depth — complements transactional outbox / idempotency (**section 5**).
- **Horizontal consumers:** multiple worker replicas on one **durable** JetStream consumer; document **ack** semantics so idempotent handlers remain safe.

---

## Service-to-service and public APIs

- **S2S authentication:** short-lived tokens or mTLS between internal services; rotation and audit — not a substitute for user RBAC (**section 3**).
- **Versioning and deprecation:** stable **API / event** versions (`schema_version`, path prefixes) and a written deprecation window — aligns with repo “no long-lived dual stacks” rules unless product explicitly needs a migration period.

---

## Abuse, limits, compliance (beyond lightweight audit)

- **Rate limiting:** gateway and hot endpoints; optional **per space** / **per user** — pairs with **section 2** resolution.
- **Space / org data lifecycle:** export and **delete** / offboarding for a **space** or **organization** (GDPR-style B2B requests) — builds on **section 2** and **section 8** (storage objects).

---

## Data and performance

- **Connection pooling:** PgBouncer (or pooler mode), max connections vs **N app replicas** — avoid connection storms on deploy.
- **Read path for heavy reporting:** read replica or batch jobs so OLTP stays healthy — **section 4** remains source of truth for domain shape.
- **Distributed cache (optional):** if introduced, **cache keys include `space_id`** and invalidation strategy is explicit (events, TTL, or both).

---

## Product-level multi-space features

- **Quotas:** storage, seats, API volume per **space** or **organization** — ties to **section 2**, **section 8**, and billing if added later.
- **White-label / branding:** logos, colors, email **from** domain — ties to **section 6** (settings) and **section 7** (i18n / templates).

---

## Release and schema safety

- **Expand/contract migrations:** zero-downtime pattern when **horizontally scaled** instances run mixed code versions briefly.
- **Gradual feature exposure:** space-scoped or percentage rollout on top of **section 6** feature flags.

---

## Supabase / Auth hardening (optional)

- **`service_role` discipline:** document and test that server paths using the service key **always** filter by `space_id` / membership when acting on behalf of users — RLS may not apply the same way.
- **Optional active `space_id` in JWT:** Supabase Auth Hook to inject claim; **rotation** and test coverage when switching space frequently — alternative to cookie-only resolution (see primary plan **phase 2**).

---

## Realtime and Storage (deepening)

- **Realtime:** subscribe policies and channel naming aligned with **`space_id`** (extends **section 2** and **section 8** when Realtime is in scope).
- **Storage:** advanced CORS, virus scanning, lifecycle policies beyond the first bucket slice — **section 8**.

---

When a phase-3 theme becomes a first-class deliverable, add a numbered subsection to the primary checklist or a dedicated ADR and trim this file to avoid duplication.
