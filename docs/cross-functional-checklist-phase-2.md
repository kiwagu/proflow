# Cross-functional checklist — phase 2 (memory)

**Purpose:** Ideas that are **not** in the primary implementation checklist but are common for **multi-tenant products**, **multiple services**, and **horizontal scaling**. Use as a **reminder surface**; promote items into [`cross-functional-checklist.md`](./cross-functional-checklist.md) when they become active work.

**Relationship to phase 1:** [`cross-functional-checklist.md`](./cross-functional-checklist.md) covers **custom entity IDs** (**section 1**), **space isolation** (**section 2**), RBAC (**3**), unified model (**4**), idempotent side effects (**5**), settings (**6**), i18n (**7**), materials (**8**), and **audit log** (**9**). Phase 2 assumes those concepts exist where relevant.

**See also:** [`cross-functional-checklist-phase-3.md`](./cross-functional-checklist-phase-3.md) — third deferral bucket for items not in the current space-isolation slice.

---

## Observability and operations

- **Structured context everywhere:** propagate **`requestId`**, **`space_id`** (when resolved), and **`user.id`** into app logs across Next shells, Bun workers, and Edge — extends **section 9** vs **operational** logging (`@workspace/logger`; see primary checklist and `known-issues.md`).
- **Metrics and tracing:** RED/USE per service; **OpenTelemetry** (or equivalent) with shared trace id from gateway through workers — helps debug cross-service latency under many replicas.
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

## Abuse, limits, compliance (beyond audit log)

- **Rate limiting:** gateway and hot endpoints; optional **per space** / **per user** — pairs with **section 2** resolution.
- **Space data lifecycle:** export and **delete** / offboarding for a **space** or **organization** (GDPR-style B2B requests) — builds on **section 2** and **section 8** (storage objects).

---

## Data and performance

- **Connection pooling:** PgBouncer (or pooler mode), max connections vs **N app replicas** — avoid connection storms on deploy.
- **Read path for heavy reporting:** read replica or batch jobs so OLTP stays healthy — **section 4** remains source of truth for domain shape.
- **Distributed cache (optional):** if introduced, **cache keys include `space_id`** and invalidation strategy is explicit (events, TTL, or both).

---

## Product-level multi-tenant features

- **Quotas:** storage, seats, API volume per **space** or **organization** — ties to **section 2**, **section 8**, and billing if added later.
- **White-label / branding:** logos, colors, email **from** domain — ties to **section 6** (settings) and **section 7** (i18n / templates).

---

## Release and schema safety

- **Expand/contract migrations:** zero-downtime pattern when **horizontally scaled** instances run mixed code versions briefly.
- **Gradual feature exposure:** space-scoped or percentage rollout on top of **section 6** feature flags.

---

When a phase-2 theme becomes a first-class deliverable, add a numbered section to the primary checklist and trim this file to avoid duplication.
