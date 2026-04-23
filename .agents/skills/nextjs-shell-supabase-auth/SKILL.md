---
name: nextjs-shell-supabase-auth
description: Use when: scaffolding or wiring a gateway-mounted Next.js App Router shell protected by Supabase SSR behind apps/web or nginx.
---

# New protected Next.js shell (Supabase + gateway)

## Pyramid Layer

- Layer: L1 workflow.

## Use This When

- Start here for a new or changed gateway-mounted Next.js shell protected by Supabase SSR.
- Use this skill when the task spans proxy placement, guest policy, redirects, or app base paths.

## Stop Here If

- Stop after the checklist below if the task stays inside a standard Next shell pattern.
- Descend only when the task crosses into Payload, blocking-route behavior, or shared gateway/env policy.

## Descend To

- Shared routing rule: `/.cursor/rules/gateway-shell-routing.mdc`
- Blocking-route rule: `/.cursor/rules/nextjs-blocking-routes-suspense.mdc`
- Shared env naming: `/.cursor/rules/monorepo-env-minimalism.mdc`
- Payload shells: `/.agents/skills/payload-supabase-gateway-auth/SKILL.md`

## Preconditions

- Browsers use a **single public origin** (e.g. `apps/web` in dev, nginx in prod). The new app is served under a **path prefix** (`basePath`) aligned with `NEXT_PUBLIC_GATEWAY_*` and gateway rewrites.
- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; optional server secrets per app.

## Checklist

- **Design pattern expectation:** as shell complexity grows, keep proxy/auth orchestration thin and move variant behavior into standard patterns such as policy objects, adapters, factories, or strategy + registry helpers instead of accumulating route-specific branching in one file.

### 1. App package

- Next.js App Router; set **`basePath`** in `next.config` to the gateway segment (e.g. `/portal`).
- Depend on `@workspace/gateway-auth` and `@supabase/ssr`.
- For pages/layouts with async auth reads (`supabase.auth.getClaims()`, session reads, `cookies()`, `headers()`, `connection()`) **or** `await searchParams` / `await params` (Promise props), render that async work inside a **child server component** that is wrapped by **`<Suspense fallback={...}>`** from a **sync** `page.tsx`. Do **not** call `connection()` or await dynamic props on the default export async page without that boundary — Next.js 16 reports **blocking route** (see `.cursor/rules/nextjs-blocking-routes-suspense.mdc`).

### 2. `updateSession` (Supabase SSR)

- Implement **`lib/supabase/proxy.ts`** or **`src/lib/supabase/proxy.ts`** with **`updateSession(request: NextRequest)`**:
  - Early exit if `!hasSupabaseShellEnv` from `@workspace/gateway-auth/env` (optional pattern).
  - **`createServerClient`** with `cookies.getAll` / `setAll` — same mutation pattern as `apps/platform/lib/supabase/proxy.ts`.
  - **`supabase.auth.getClaims()`** — treat presence of claims as authenticated (match existing shells).
  - **`const path = pathWithinAppBasePath(request.nextUrl.pathname, APP_BASE)`** with **`APP_BASE = getAppBasePath('/your-segment')`** from `@workspace/gateway-auth/gateway-paths`.
  - Skip further checks for **`isNextOrPublicAssetPathWithinApp(path)`** from `@workspace/gateway-auth/password-recovery`.
  - If the app needs **password recovery** like platform, reuse the same recovery helpers **before** guest gating — do not duplicate ad hoc cookie logic; copy the platform block from `apps/platform/lib/supabase/proxy.ts` only when required.
  - **Guest gate:** if `!user && !isShellPathAllowedForGuest(path, POLICY)` then **`NextResponse.redirect(buildPlatformSignInUrl(gatewayReturnPathForApp(request, APP_BASE), request.headers), 307)`** (`site-origin` + `gateway-return-path`).
  - Return **`NextResponse.next({ request })`** with cookies applied via `setAll`.

### 3. `proxy.ts` placement

- **`proxy.ts` must sit next to the `app` directory.** If App Router is **`src/app`**, use **`src/proxy.ts`** — a root-level `proxy.ts` is **ignored**; auth redirects never run.
- Export **`proxy`** calling `updateSession` and returning its result; add **`config.matcher`** consistent with sibling apps (exclude static assets as needed).

### 4. Guest policy

- Add **`YOUR_APP_SHELL_GUEST_ACCESS`** (`ShellGuestAccessPolicy`) in `packages/gateway-auth/src/shell-guest-access.ts` or a dedicated module re-exported from `gateway-auth`.
- Use **`isShellPathAllowedForGuest(pathWithinBase, policy)`** only with paths from **`pathWithinAppBasePath`**, never full gateway paths (`/platform/...` style).
- Prefer **narrow** `allowGuestPrefixes`; widening `/` or `/api` has security impact — document exceptions.

### 5. Gateway and Turborepo

- Wire the new upstream path in **`apps/web`** (rewrites, dev upstream host/port) and production nginx snippets.
- Add any new env vars to **`turbo.json` `globalEnv`** if builds must invalidate on them.
- Set **`NEXT_PUBLIC_GATEWAY_ORIGIN`** (and forwarded `Host` / `X-Forwarded-*` in prod) so **`resolvePublicSiteOrigin`** / **`buildPlatformSignInUrl`** stay on the public host.

### 6. Platform sign-in

- After Supabase login, users return via **`?next=`** to the gateway path; ensure the platform login flow supports that (existing pattern).

### 7. Payload-specific shells

- If the app embeds Payload admin, follow [payload-supabase-gateway-auth](../payload-supabase-gateway-auth/SKILL.md) in addition to this checklist.

## Anti-patterns

- **Guest vs protected** implemented only in React (`redirect()` in pages) for shell entry — use **proxy** **307** to avoid flash and wrong UX.
- Supabase enforcement **only** in **`apps/web`** for routes served by another Next app on a subpath.
- Scattered **`path.startsWith(...)`** for public routes — use **`ShellGuestAccessPolicy`** only.
- Calling async auth/session APIs in route trees outside **`<Suspense>`** (Next.js 16 `blocking-route` error). Wrap async page content in a Suspense boundary with a lightweight fallback.

## Reference implementations

| App | Notes |
|-----|--------|
| `apps/platform` | Recovery flow + `PLATFORM_SHELL_GUEST_ACCESS` |
| `apps/author` | Same proxy/policy pattern; Payload bridge is extra |

## Related

- `.cursor/rules/monorepo-env-minimalism.mdc` — avoid duplicate env aliases; reuse gateway keys where shells and services must agree (e.g. `GATEWAY_ENTRY_ORIGIN`, `NEXT_PUBLIC_GATEWAY_PLATFORM_PATH`).
- `.cursor/rules/notifications-central-email.mdc` — outbound email via **`@workspace/notifications`** (React Email + **`renderEmail()`**, SMTP in the package); shells must not use nodemailer or raw HTML email.
- `.cursor/rules/nextjs-blocking-routes-suspense.mdc`
- `.cursor/rules/gateway-shell-routing.mdc`
- `packages/gateway-auth/src/shell-guest-access.ts`, `site-origin.ts`, `gateway-return-path.ts`, `path-within-base.ts`
