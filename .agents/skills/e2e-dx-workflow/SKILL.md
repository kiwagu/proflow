---
name: e2e-dx-workflow
description: Use when: a change touches critical flows and you need the repository's standard platform or author E2E workflow.
user-invocable: false
---

# E2E DX Workflow

## Pyramid Layer

- Layer: L1 workflow.

## Use This When

- Start here when a change touches authentication, session flows, protected routes, profile UX, or shell entry behavior.
- Use this skill to decide which E2E command set and coverage level to load.

## Stop Here If

- Stop after the command, environment, and coverage guidance below are enough to execute the task.
- Descend only if the task also changes repository-wide E2E policy.

## Descend To

- Repository E2E policy: `/.cursor/rules/e2e-required-for-critical-flows.mdc`
- Shell auth workflows: `/.agents/skills/nextjs-shell-supabase-auth/SKILL.md`, `/.agents/skills/payload-supabase-gateway-auth/SKILL.md`
- Continue within this file for commands, prerequisites, selectors, and new-spec guidance.

Use this skill when implementing or modifying authentication/session/profile behavior, gateway-mounted shells (`/platform`, `/author`), and related UI contracts.

## Workspace and commands

Primary workspace: `tests/e2e`

Root commands:

- `bun run test:e2e:smoke` — PR baseline
- `bun run test:e2e:full` — full/nightly run

Workspace commands:

- `bun --cwd tests/e2e run test:e2e`
- `bun --cwd tests/e2e run test:e2e:smoke`
- `bun --cwd tests/e2e run test:e2e:full`
- `bun --cwd tests/e2e run test:e2e:headed`
- `bun --cwd tests/e2e run typecheck`
- `bun --cwd tests/e2e run lint`
- `bun --cwd tests/e2e run format`

## Required environment

Use `tests/e2e/.env` based on `tests/e2e/.env.example`.

Required variables:

- `PLAYWRIGHT_BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional:

- `E2E_SUPABASE_URL`
- `E2E_SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY` (Stagehand smoke)

## Runtime model

The e2e suite uses seeded users via Supabase service-role:

- global setup seeds temporary user
- runtime state persists user identity for tests
- global teardown removes user/profile and runtime state

Keep this model deterministic and isolated. Avoid shared mutable user state across unrelated specs.

## Space invite smoke tests

- UI flow (`platform-space-invite.e2e.spec.ts`) does **not** require a separate platform email worker. **`apps/platform`** publishes the invite job to JetStream; **`services/notifications`** consumes and sends SMTP via **`@workspace/notifications`**. For full stack locally, run root **`bun run dev`** (Turbo includes `services/notifications`) and set **`NATS_URL`** on **platform** and **notifications-service** (same broker), plus `SMTP_*` and **the same** `GATEWAY_ENTRY_ORIGIN` / `NEXT_PUBLIC_GATEWAY_PLATFORM_PATH` as the gateway + platform (see `.cursor/rules/monorepo-env-minimalism.mdc`).

## Multi-app coverage (`/platform` and `/author`)

Smoke tests assume the **gateway origin** in `PLAYWRIGHT_BASE_URL` (e.g. `https://app.local`):

- **Platform**: login form, profile, logout — see `auth-*.e2e.spec.ts`.
- **Author**: guests hitting `/author` or `/author/admin` are redirected to platform sign-in; after platform login, `/author` should resolve to Payload admin (`/author/admin`) via the bridge when Payload + DB are up.

Author admin smoke may need more time (bridge + Payload); specs use extended timeouts where needed.

**Identity sync (`@full`):** `identity-author-sync.e2e.spec.ts` — Supabase `auth.admin` create/delete vs Payload Mongo `users` row (needs `E2E_AUTHOR_MONGO_URL`, `internal_secret` from `make db-push`, NATS, `NATS_URL` in `apps/author`, and **`bun run dev`** there so Next + JetStream worker run). Not part of `@smoke`; use `test:e2e:full`.

## New gateway-mounted apps

When adding another Next shell behind the gateway:

1. Suggest adding `tests/e2e/src/<app>-*.e2e.spec.ts` with `@smoke` cases for:
   - guest → expected auth boundary (usually platform sign-in with `next=` return path)
   - one happy-path authenticated entry if a stable post-login URL exists
2. Reuse platform `data-testid` selectors when login is rendered by `apps/platform`.
3. Document any extra services (e.g. Mongo for Payload) in `tests/e2e/README.md` prerequisites.

## Stable selector contract

When changing auth/profile UI:

- preserve or intentionally migrate `data-testid` selectors
- update e2e in the same change
- avoid selector strategies based on fragile text when a test ID exists

Critical selectors include:

- auth: login form, email/password, submit, logout
- profile: form, fields, submit, success/error
- author: URL assertions on `/author` and `/author/admin` (admin UI may use Payload defaults; prefer URL-level smoke unless stable test IDs are added)

## Recommended authoring pattern

1. Update UI behavior + stable selectors.
2. Update/extend specs in `tests/e2e/src/*.e2e.spec.ts`.
3. Run `typecheck`, `lint`, then `test:e2e:smoke`.
4. If behavior is broad/risky, run `test:e2e:full`.
5. When test execution is blocked by infra, report exact missing prerequisite and command to rerun.

## Design pattern expectation

- When E2E support code grows beyond a small helper, prefer standard patterns such as page objects, factories/builders for seeded data, and strategy/registry selection for variant-specific test flows instead of ad hoc conditionals.

## Stagehand usage

Stagehand is optional and used for exploratory browser interaction:

- `bun --cwd tests/e2e run stagehand:smoke`

Do not replace deterministic Playwright assertions with LLM-only checks in core smoke coverage.
