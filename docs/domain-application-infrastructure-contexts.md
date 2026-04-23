# Domain, application, and infrastructure contexts

This document gives the project a shared starting point for feature analysis. The goal is not dogmatic clean architecture. The goal is a stable analysis order so a feature is understood from business intent outward.

## Core principle

Start with the **domain context**.

The domain is the source of intent:

- what capability the system provides
- what invariants must hold
- who is allowed to do what
- which state transitions are valid
- which side effects are required and how idempotent they must be

Only after that should analysis move to:

- **application context**: how the feature is orchestrated through requests, workers, actions, and transactions
- **infrastructure context**: which concrete technologies persist, transport, or expose the behavior

If analysis starts from a route, page, collection config, SQL statement, or transport handler before the invariant is named, the odds of local but incorrect changes go up.

## What “domain” means in this project

In this repository, the domain is not a single `src/domain` folder. It is distributed across authoritative contracts and rules:

- business boundaries and ownership docs
- permission and scope semantics
- event contracts
- idempotency semantics
- shared policy helpers and pure decision functions
- Postgres-backed invariants that define what the system allows

That means domain purity here is **conceptual**, not ceremonial. The business model should be understandable without Next.js, Payload, Supabase client APIs, SMTP, or JetStream details even when final enforcement happens in SQL, RLS, or RPCs.

## Three contexts

| Context | Purpose | Typical artifacts in this project | What should not define it |
| --- | --- | --- | --- |
| Domain | Business capability, invariants, ownership, permissions, events, lifecycles | `docs/cross-functional-checklist.md`, `docs/identity-domain-boundary.md`, `docs/data-ownership-matrix.md`, `packages/domain-events`, `packages/rbac`, `packages/entity-id`, pure decision helpers | Route layout, table naming alone, framework entry points |
| Application | Use-case orchestration and policy execution | server actions, route handlers, worker entry points, app-level service modules, orchestration helpers in apps/services/packages | SMTP provider details, raw SQL transport details, component structure alone |
| Infrastructure | Concrete persistence and transport mechanisms | Supabase tables/RLS/RPC, Payload collections, JetStream/NATS, SMTP transports, storage buckets, Next proxy and config | Business policy or ownership rules |

## Analysis order for any feature

1. Identify the bounded context.
2. State the business invariant or policy.
3. Find the authoritative source of truth.
4. Trace the application flow that carries that intent.
5. Inspect the concrete adapters and persistence details.

## Feature analysis checklist

Use this checklist when starting any non-trivial feature, bugfix, or refactor.

### 1. Domain first

- What business capability is this about?
- Which bounded context owns it?
- Which invariant, permission, lifecycle transition, or idempotency rule must hold?
- What is the business event or state change that actually matters?

### 2. Source of truth

- Which module, document, or contract is authoritative?
- Which modules are mirrors, projections, or delivery adapters only?
- Which writes are allowed, and from where?

### 3. Domain model surface

- Which domain concepts are involved: user, organization, space, membership, role, invite, resource, notification job, audit event?
- Which identifiers and scope keys matter?
- Which permission keys or critical capabilities are relevant?

### 4. Application flow

- Which request, server action, worker, RPC entry point, or event consumer coordinates the feature?
- Where is input validated?
- Where is session or auth state translated into domain meaning?
- Where does the transaction or unit of work begin and end?

### 5. Infrastructure adapters

- Which table, RLS policy, RPC, queue, template, storage bucket, or framework handler implements the behavior?
- Which external services are involved?
- What infrastructure detail must stay out of the domain decision itself?

### 6. Side effects and idempotency

- Does the feature emit email, fanout, mirror sync, audit, or background work?
- What makes that side effect logically unique?
- Where is dedupe enforced?

### 7. Read and test boundaries

- What is the smallest pure decision that can be tested without infra?
- What orchestration path needs integration coverage?
- What end-to-end user path needs E2E coverage?

### 8. First files to read

Before editing anything, identify one file per context:

- one domain source
- one application orchestrator
- one infrastructure adapter

If those three are not clear, analysis is still too shallow.

## Bounded context map

### 1. Identity and account lifecycle

**Domain concern**

- Who a person is in the system.
- How they authenticate.
- Whether the account exists at all.
- Which changes are identity-level versus domain-level.

**Start analysis here**

- `docs/identity-domain-boundary.md`
- `docs/data-ownership-matrix.md`
- `docs/cross-functional-checklist.md` sections 3 and 4

**Application context**

- Platform auth and account-management flows.
- Identity sync flows into Author and other mirrors.
- Workers or hooks that react to lifecycle events.

**Infrastructure context**

- Supabase Auth.
- `public.profiles` mirror.
- Edge lifecycle fanout.
- Payload mirrored user collection.

### 2. Organization and space lifecycle

**Domain concern**

- Organization-to-space ownership.
- Active space resolution.
- Membership state and same-space boundaries.
- Which rows are space-scoped and what cross-space access means.

**Start analysis here**

- `docs/cross-functional-checklist.md` section 2
- `docs/data-ownership-matrix.md`

**Application context**

- Onboarding.
- Space selection.
- Invite accept/revoke flows.
- Space-admin actions.
- Request context resolution.

**Infrastructure context**

- `organizations`, `spaces`, `organization_memberships`, `space_memberships`, `space_invites`.
- Active-space cookie and optional query slug.
- JetStream lifecycle fanout to Author.

### 3. RBAC and critical capabilities

**Domain concern**

- Which permissions exist.
- How roles compose.
- Which actions are regular permission checks versus critical capability paths.
- Which scope a permission applies to.

**Start analysis here**

- `docs/cross-functional-checklist.md` section 3
- `docs/rbac/role-permission-test-matrix.md`
- `packages/rbac`

**Application context**

- Org-admin and super-admin flows.
- Permission-aware route/server-action guards.
- Domain user-management delegation.

**Infrastructure context**

- RBAC tables and seed data.
- RPCs and SQL helpers.
- UI visibility gates and navigation helpers.

### 4. Invitations, notifications, and idempotent side effects

**Domain concern**

- Which domain action emits a side effect.
- What makes a send or sync logically unique.
- What duplicates are acceptable versus forbidden.
- Which events are authoritative and which consumers are mirrors.

**Start analysis here**

- `docs/cross-functional-checklist.md` section 5
- `packages/domain-events`

**Application context**

- Invite creation flows.
- Outbox enqueue points.
- Notification workers.
- Identity fanout consumers.

**Infrastructure context**

- `public.outbox_jobs`.
- `pgmq` transport.
- JetStream/NATS.
- SMTP transport and React Email rendering.

### 5. Resource access, scopes, and future materials

**Domain concern**

- What a resource is in a space.
- Who may own, read, update, publish, or delete it.
- Which scope links or membership checks are required.
- Which lifecycle states are valid.

**Start analysis here**

- `docs/cross-functional-checklist.md` section 4
- `docs/identity-domain-boundary.md`

**Application context**

- Platform and future shell flows that create or mutate resources.
- Shared authorization helpers and list filters.
- Upload and archive use cases.

**Infrastructure context**

- Space-scoped tables.
- RLS policies.
- Storage path conventions.
- Future bucket and archive ingestion logic.

### 6. Global settings and audit

**Domain concern**

- Which settings are global versus space-scoped.
- Which mutations require critical capability.
- Which actions must be durably auditable.

**Start analysis here**

- `docs/cross-functional-checklist.md` sections 6 and 9

**Application context**

- Admin settings flows.
- Break-glass entry points.
- Audit recording wrappers.

**Infrastructure context**

- Settings store.
- Audit tables or streams.
- Runtime log-level propagation.

## Module map by context

| Module or area | Primary context | Why |
| --- | --- | --- |
| `packages/domain-events` | Domain | Event contracts express business lifecycle semantics before transport details. |
| `packages/rbac` | Domain | Permission vocabulary and critical capability semantics belong to business policy. |
| `packages/entity-id` | Domain | Shared identity shape and parsing rules define business-level identifiers across runtimes. |
| `packages/gateway-auth` | Domain + application seam | Contains pure decisions such as active-space resolution, then app-facing auth helpers around them. |
| `apps/platform` | Application | Main orchestration surface for operator workflows, onboarding, invites, and admin actions. |
| `apps/author` | Application + infrastructure seam | Read-mostly shell and mirror bridge; should not become an authority for identity or RBAC writes. |
| `apps/web` | Application/infrastructure | Gateway routing and shell mounting, not the source of domain policy. |
| `services/notifications` | Application | Executes notification use cases and outbox processing; delivery semantics come from domain intent. |
| `packages/notifications` | Infrastructure | Email rendering and transport adapters. |
| `supabase/migrations` and SQL RPCs | Infrastructure implementing domain invariants | Persistence and enforcement layer for the policies defined by the domain. |

## How to start analyzing a feature

### Start with the domain question

- What business capability is changing?
- Which bounded context owns it?
- What must remain true?
- Which roles, scopes, events, or idempotency guarantees matter?

### Then move to the application question

- Which request, job, action, or worker coordinates the change?
- Where are transaction boundaries?
- Where is auth/session translated into domain input?
- Where are retries, dedupe, and fanout coordinated?

### Then move to the infrastructure question

- Which table, policy, RPC, collection, queue, or transport implements the behavior?
- Which module is only an adapter and must not become the source of truth?

## Fast starting points by feature type

| If the feature is about... | Start here first | Then inspect |
| --- | --- | --- |
| user lifecycle, auth identity, mirrors | `docs/identity-domain-boundary.md` | Platform auth flow, identity sync workers, Supabase/Auth mirror infra |
| org, space, membership, invite flow | `docs/cross-functional-checklist.md` section 2 | `packages/gateway-auth`, Platform invite/onboarding flows, space tables/RPCs |
| roles, permissions, super-admin, break-glass | `docs/cross-functional-checklist.md` section 3 | `packages/rbac`, Platform admin flows, RBAC SQL helpers |
| duplicate side effects, emails, sync fanout | `docs/cross-functional-checklist.md` section 5 | enqueue points, `services/notifications`, outbox/queue infrastructure |
| resource ownership, scopes, future materials | `docs/cross-functional-checklist.md` section 4 and `docs/identity-domain-boundary.md` | shared access helpers, app flows, space-scoped tables and storage |
| global settings or audit | `docs/cross-functional-checklist.md` sections 6 and 9 | admin flows, critical capability checks, settings/audit infrastructure |

## Worked example: space invite flow

This is a concrete example of how to analyze a feature without starting from framework details.

### Feature statement

"A space admin invites someone to a space, the invite email is delivered once, and the recipient is routed into the right accept flow depending on whether they already have an auth account."

### 1. Domain context

**Bounded context**

- Organization and space lifecycle.
- Invitation lifecycle.
- Idempotent notification side effects.

**Business invariants**

- An invite must belong to one space.
- Only a valid pending invite may be accepted.
- Expired or invalid invites must not proceed.
- The system may emit multiple technical signals, but the logical email send must be deduplicated.
- Existing and first-time invitees may follow different accept paths, but the domain action is still the same: accept a pending space invite.

**Source of truth**

- Invite lifecycle and space ownership rules come first from `docs/cross-functional-checklist.md` sections 2 and 5.
- The invite row and outbox job are authoritative state.
- Route handlers and email delivery are application and infrastructure, not the domain source of truth.

### 2. Application context

**Orchestrators to inspect first**

- Invite entry route: `apps/platform/app/invite/start/route.ts`
- Invite auth lookup: `apps/platform/lib/space-invite.auth-lookup.server.ts`
- Outbox worker: `services/notifications/src/outbox-worker.ts`

**Application responsibilities**

- Parse and validate the invite token.
- Resolve whether the invitee already has an auth account.
- Choose the next application step: complete vs password setup.
- Generate session establishment flow.
- Claim, deliver, complete, or retry outbox jobs.

The application layer coordinates these steps, but it should not redefine invite validity semantics or dedupe rules on its own.

### 3. Infrastructure context

**Concrete mechanisms**

- `space_invites` table stores invite lifecycle state.
- Supabase Auth admin APIs generate the magic link and verify OTP.
- `public.outbox_jobs` stores idempotent notification intent.
- `pgmq` and outbox RPCs provide claim/complete/retry transport.
- SMTP and React Email provide actual delivery.

### 4. Where analysis should start for different changes

| Change request | Start from | Then inspect |
| --- | --- | --- |
| "Change who is allowed to create or accept invites" | domain policy and invite lifecycle docs | RBAC helpers, RPCs, RLS |
| "Change the redirect path for existing vs first-time invitees" | domain meaning of the two states | `app/invite/start/route.ts`, auth lookup helper |
| "Fix duplicate invite emails" | idempotency rule in section 5 | outbox enqueue points, worker, idempotency keys |
| "Change email copy or template rendering" | domain event meaning and required data | notification template and delivery adapters |
| "Author should react to invite-related lifecycle changes" | domain ownership and event contract | JetStream consumers and mirror adapters |

### 5. Practical reading order

For this feature, a good analysis sequence is:

1. `docs/cross-functional-checklist.md` sections 2 and 5
2. `docs/identity-domain-boundary.md` if user/account lifecycle becomes relevant
3. `apps/platform/app/invite/start/route.ts`
4. `apps/platform/lib/space-invite.auth-lookup.server.ts`
5. `services/notifications/src/outbox-worker.ts`
6. outbox handlers and email templates if delivery behavior is part of the change

## Guardrails

- Do not let a mirror or consumer redefine the domain.
- Do not start from infrastructure naming and work backward into business meaning.
- Do not force full hexagonal folder ceremony onto simple UI or straightforward CRUD.
- Do insist that every non-trivial feature can be explained as domain intent first, orchestration second, infrastructure third.