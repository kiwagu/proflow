# E2E for platform auth/profile

This workspace provides end-to-end coverage for:

- guest access to protected routes
- UI login flow
- profile update persistence across reloads
- profile avatar upload, persisted read, remove, and persisted clear
- logout and protected-route access after sign-out
- **Author (`/author`)**: guests redirected to platform sign-in; authenticated users reach Payload admin (`/author/admin`) via the bridge
- **Notifications / outbox (`@full`)**: direct email enqueue, GoTrue auth-email enqueue, and platform invite delivery through `public.outbox_jobs` with `pgmq` transport underneath

## Policy and workflow references

- Rule (mandatory coverage policy): `/.cursor/rules/e2e-required-for-critical-flows.mdc`
- Skill (agent workflow/playbook): `/.agents/skills/e2e-dx-workflow/SKILL.md`

## Prerequisites

1. Run local infra and apps:
   - `make stack-up`
   - `bun run dev`
2. Ensure hosts/TLS are configured for:
   - `https://proflow.local`
   - `https://proflow.local/platform`
3. Copy env template:
   - `cp tests/e2e/.env.example tests/e2e/.env`
4. Fill required variables:
   - `NEXT_PUBLIC_SUPABASE_URL` (usually `https://api.proflow.local`)
   - `SUPABASE_SERVICE_ROLE_KEY`

**Author / Payload:** smoke that opens `/author/admin` expects the author app, MongoDB, and Payload to be running (same as local dev: `make stack-up` + `bun run dev`). If Payload is down, the authenticated author test may fail while platform-only tests still pass.

**Identity sync chain (`@full`):** `src/identity-author-sync.e2e.spec.ts` creates and deletes a Supabase Auth user via the service role and polls Author’s MongoDB (`users.supabaseSub`) to verify `user.created` / `user.deleted` fan-out into Payload. Requires:

- `E2E_AUTHOR_MONGO_URL` (copy `MONGO_URL` from `apps/author/.env`)
- NATS (Supabase compose) + Author **`apps/author/.env`** with `NATS_URL` (e.g. `nats://127.0.0.1:4222`); **`bun run dev`** starts Next and the JetStream consumer together
- `identity_sync.outbound_config.internal_secret` populated (e.g. `make db-push` after stack reset)

It is **not** selected by `@smoke`; run `bun run test:e2e:full` with the env above for regression/nightly.

**Notifications / outbox (`@full`):** `src/notifications-outbox.e2e.spec.ts` exercises the outbox-ledger plus `pgmq` transport path end-to-end and requires:

- `services/notifications` running locally (default `http://127.0.0.1:3010`)
- `NOTIFICATIONS_INTERNAL_TOKEN` or `E2E_NOTIFICATIONS_INTERNAL_TOKEN`
- Maildev reachable (default `http://127.0.0.1:9090`, SMTP usually `127.0.0.1:2500`)

Optional overrides:

- `E2E_NOTIFICATIONS_URL`
- `E2E_NOTIFICATIONS_INTERNAL_TOKEN`
- `E2E_MAILDEV_URL`

**Avatar / storage smoke (`@smoke`):** `src/auth-profile.e2e.spec.ts` covers the current storage MVP for profile avatars: browser upload into the `media` bucket, persisted public URL on reload, remove, and persisted clear after save. It uses the same local stack and env as the other platform profile tests; no extra storage-specific env vars are required.

The test suite is autonomous: each test seeds a temporary Supabase auth user
using Playwright `globalSetup`, then removes it in `globalTeardown`.
Specs consume this user via a typed Playwright fixture: `seededUser`.

## Run tests

- `bun run test:e2e:smoke` (from repo root, PR checks)
- `bun run test:e2e:full` (from repo root, nightly/full regression)
- `bun --cwd tests/e2e run test:e2e`
- `bun --cwd tests/e2e run test:e2e:smoke` (for PR checks)
- `bun --cwd tests/e2e run test:e2e:full` (for nightly/full regression)
- `bun --cwd tests/e2e run test:e2e:headed`

## How to observe and inspect results

1. Run smoke first:
   - `bun run test:e2e:smoke`
2. Run headed mode to watch the browser flow:
   - `bun run --cwd tests/e2e test:e2e:headed`
3. Open HTML report:
   - `bunx playwright show-report tests/e2e/playwright-report`
4. For failed tests, inspect trace/video/screenshots from:
   - `tests/e2e/test-results`

## Workspace quality commands

- `bun --cwd tests/e2e run typecheck`
- `bun --cwd tests/e2e run lint`
- `bun --cwd tests/e2e run format`

## Stagehand local runtime

You can run a local Stagehand session against the same stack:

- `bun --cwd tests/e2e run stagehand:smoke`

It opens `PLAYWRIGHT_BASE_URL` and prints observed auth controls in JSON.

## Troubleshooting

### TLS error during user seeding (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`)

If seed fails in `globalSetup` with certificate verification errors, run Node with system CA:

- `NODE_OPTIONS="--use-system-ca --no-deprecation --import=tsx/esm" bun run test:e2e:smoke`

Or ensure local cert trust is configured correctly for:

- `proflow.local`
- `api.proflow.local`

### Teardown error after setup failure (`ENOENT ... .runtime/seeded-user.json`)

This usually appears after a setup failure and is a secondary error.
Fix the setup root cause first (most often TLS), then rerun tests.

### Seed fails with `Failed to seed e2e user` (empty or `{}` error)

`auth.admin.createUser` requires the **service role** key (JWT labeled `service_role` in Supabase project settings / local `supabase status` secrets).

- Set `SUPABASE_SERVICE_ROLE_KEY` in `tests/e2e/.env` — not `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and not the anon key.
- `NEXT_PUBLIC_SUPABASE_URL` must be the **Auth API base** Kong serves (e.g. `https://api.proflow.local`), same as in `apps/platform/.env`.

Re-run with verbose error text from the updated helper if it still fails.

## Manual chat scenarios (step-by-step)

Use these when you want to drive the browser manually via chat (slow TDD loop)
before or alongside automated Playwright specs.

### Interaction mode prompt

Use this as the first chat message:

```text
Work in strict step mode:
1) one browser action per response
2) after each action report current URL + assertion status
3) stop and wait for my confirmation before next action
4) do not modify code/files, browser actions only
```

### Scenario 1: guest is blocked from protected profile route

```text
Given I am not authenticated
When I navigate to https://proflow.local/platform/profile
Then I should be redirected to login flow
And I should see data-testid=auth-login-form
```

### Scenario 2: successful login from platform root

```text
Given I am on https://proflow.local/platform
And I can see data-testid=auth-login-form
When I fill data-testid=auth-login-email with "<EMAIL>"
And I fill data-testid=auth-login-password with "<PASSWORD>"
And I click data-testid=auth-login-submit
Then URL should contain /platform/profile
And I should see data-testid=profile-form
```

### Scenario 3: profile edit persists after reload

```text
Given I am authenticated and on /platform/profile
When I read current data-testid=profile-display-name as previousDisplayName
And I read current data-testid=profile-bio as previousBio
And I fill data-testid=profile-display-name with "TDD Profile Name"
And I fill data-testid=profile-bio with "TDD Profile Bio"
And I click data-testid=profile-save-submit
Then I should see data-testid=profile-save-success

When I reload the page
Then data-testid=profile-display-name should equal "TDD Profile Name"
And data-testid=profile-bio should contain "TDD Profile Bio"
```

### Scenario 4: logout invalidates access

```text
Given I am authenticated and on /platform/profile
When I click data-testid=auth-logout-button
Then I should see data-testid=auth-login-form

When I navigate to https://proflow.local/platform/profile
Then I should not stay on protected profile content
And I should see data-testid=auth-login-form
```

### Scenario 5: restore previous profile values (optional)

```text
Given I am authenticated and on /platform/profile
And I remember previousDisplayName and previousBio
When I fill data-testid=profile-display-name with previousDisplayName
And I fill data-testid=profile-bio with previousBio
And I click data-testid=profile-save-submit
Then I should see data-testid=profile-save-success
```

### Scenario 6: author guest redirect (no session)

```text
Given I am not authenticated
When I navigate to https://proflow.local/author
Then URL should contain /platform
And I should see data-testid=auth-login-form
```

### Scenario 7: author admin after platform login

```text
Given I have completed platform login (same cookies as /platform)
When I navigate to https://proflow.local/author
Then URL should eventually contain /author/admin
```
