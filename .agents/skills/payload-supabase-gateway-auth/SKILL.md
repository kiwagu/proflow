---
name: payload-supabase-gateway-auth
description: Use when: adding or debugging Payload CMS admin or API auth behind a Supabase-authenticated public gateway.
---

# Payload + Supabase + gateway auth

## Pyramid Layer

- Layer: L1 workflow.

## Use This When

- Start here for Payload admin auth, Supabase session bridging, or author-shell gateway behavior.
- Use this skill when the task crosses between Payload auth, Next proxy behavior, and public-origin redirects.

## Stop Here If

- Stop after the bridge and proxy pattern below if the task matches the standard author-shell architecture.
- Descend only if the task broadens into shell routing, blocking routes, or centralized user ownership.

## Descend To

- Shared routing rule: `/.cursor/rules/gateway-shell-routing.mdc`
- Blocking-route rule: `/.cursor/rules/nextjs-blocking-routes-suspense.mdc`
- Centralized user ownership: `/.agents/skills/platform-centralized-user-management/SKILL.md`
- Generic Next shell workflow: `/.agents/skills/nextjs-shell-supabase-auth/SKILL.md`

## Mental model

- **Supabase** owns the browser session (HTTP-only cookies via `@supabase/ssr`). The shell app’s **proxy** (`updateSession`) calls `supabase.auth.getClaims()` and issues **307** redirects for guests vs signed-in users.
- **Payload** still needs its **own JWT** (`{cookiePrefix}-token`, default `payload-token`) for the admin UI and for `Authorization: Bearer` on REST/GraphQL when using the built-in strategies.
- **Bridge**: one route reads the Supabase session, verifies the access token, syncs/creates a Payload user, sets the Payload cookie, then **307** to the final admin path. Avoid client-side navigation to that route (RSC will try to fetch it as a flight payload and fail).
- For Next.js 16 App Router pages/layouts that read auth/session data at render time, keep async content under **`<Suspense>`** to avoid `blocking-route` errors.
- Prefer standard patterns as complexity grows: adapters for token/session boundaries, policy objects for guest access rules, and strategy/registry splits for provider- or mode-specific behavior instead of expanding one bridge/proxy file indefinitely.

Reference implementation: `apps/author` in this repo.

## Implementation checklist

### 1. Payload collection auth

- Disable local password login for admin users; keep **Payload JWT** strategy for cookie-based admin sessions.
- Add a **custom auth strategy** that accepts `Authorization: Bearer <supabase_access_token>` for API clients, verifies the token, resolves the user (e.g. by `supabaseSub` or `email`), and returns `{ user }`. Register **before** the JWT strategy so Payload-issued JWTs are handled by `JWTAuthentication` (skip tokens that look like Payload JWTs, e.g. claim `collection`).
- Add a stable link to Supabase identity (e.g. `supabaseSub` indexed unique).

See `apps/author/src/collections/Users.ts` and `apps/author/src/auth/supabaseAuthStrategy.ts`.

- **Operator UX:** Centralized user management lives on the **Platform** only. Mirrored Payload `users` (and similar) may be **listed and opened** for support, but **writes** are blocked by hooks unless Local API passes `AUTHOR_USERS_WRITE_CONTEXT`; the custom Save control explains that. See `.agents/skills/platform-centralized-user-management/SKILL.md`.

### 2. Verify Supabase access token (server)

- Prefer `SUPABASE_JWT_SECRET` + HS256 for self-hosted or simple setups; otherwise verify with Supabase JWKS (`/auth/v1/.well-known/jwks.json` under `NEXT_PUBLIC_SUPABASE_URL`).
- Extract `sub` and `email` (and optionally `user_metadata.email`).

See `apps/author/src/auth/verifySupabaseAccessToken.ts`.

### 3. Issue Payload session from a verified token

- Use `getPayload`, `createLocalReq`, sync or create the user document, then issue a Payload session token and **`generatePayloadCookie`** with the collection’s auth config and `payload.config.cookiePrefix`.

See `apps/author/src/lib/establish-payload-session-from-access-token.ts` and `apps/author/src/auth/issuePayloadSession.ts`.

### 4. Bridge route (GET)

- Read Supabase session (`createServerClient` + `getSession()`), call `establishPayloadSessionFromAccessToken`, append `Set-Cookie` on a **307** `Location` to the safe `next` path (only allow `/admin` prefixes; use shared `safeNextPath` helpers).
- Build `Location` with **`resolvePublicSiteOrigin(request.headers)`** so redirects stay on the gateway host in dev (never the upstream app port).

See `apps/author/src/app/api/auth/admin-payload-bridge/route.ts`.

### 5. Optional: programmatic exchange (POST)

- Thin POST handler that accepts JSON `{ access_token }` and returns JSON + `Set-Cookie` — same core as the bridge, for non-browser clients.

See `apps/author/src/app/api/auth/supabase-payload/route.ts`.

### 6. Next.js proxy (shell)

- Place **`proxy.ts` next to `app`**: if App Router is `src/app`, use **`src/proxy.ts`** (root `proxy.ts` is ignored).
- Keep **`next.config.ts`** wrapped with **`withPayload`** from `@payloadcms/next/withPayload`; `apps/author` already does this and it should remain true for new Payload shells.
- Order matters:
  1. Skip Next static/public and recovery-only paths (`@workspace/gateway-auth`).
  2. No Supabase user + path not allowed by **guest policy** → **307** to platform (or app) sign-in with `?next=` = gateway return path.
  3. Authenticated user on `/` → **307** to admin entry if desired.
  4. Authenticated user on **`/admin`*** without **`payload-token`** → **307** to bridge with `?next=<current admin path>` (one server hop; no `/admin/login` page required).

- On Next `16.2+`, if Payload admin config or import-map changes do not appear during local dev, restart the dev server before debugging auth or bridge logic. Payload docs note a current server fast refresh limitation in this range.

See `apps/author/src/lib/supabase/proxy.ts` and `packages/gateway-auth/src/shell-guest-access.ts`.

### 7. Guest policy for the author shell

- **Default**: everything requires Supabase except listed prefixes.
- **`/api`**: usually must stay reachable for guests at the proxy layer because Payload serves REST/GraphQL under `/api` and applies its own strategies; the bridge also lives under `/api/auth/...`. Narrow additional prefixes only when you know every route’s auth.

### 8. Gateway / env

- Set **`NEXT_PUBLIC_GATEWAY_ORIGIN`** (and forwarded headers in production) so `buildPlatformSignInUrl` / `resolvePublicSiteOrigin` produce the public origin.
- Align **`NEXT_PUBLIC_GATEWAY_*_PATH`** and nginx path prefixes with `apps/web` and each app’s `basePath`.

### 9. Logout

- Clear Payload session (e.g. dedicated `full-logout` route) + `supabase.auth.signOut`, then **full document navigation** to a path the proxy treats as guest (e.g. app root) so the next **307** goes to platform — avoid `router.replace` to API or admin-only segments during teardown (RSC / aborted fetches).

See `apps/author/src/admin/logout-button.tsx` and `apps/author/src/app/api/auth/full-logout/route.ts`.

## Anti-patterns

- **Client `redirect()` or soft navigation** to a Route Handler that returns **307** — use server **307** from proxy or **hard** `window.location` only where necessary.
- **Proxy file in the wrong directory** — auth never runs; guests see **200** on protected pages.
- **Building sign-in URLs from `request.nextUrl.origin`** when the request hits the app on `:3002` — use shared origin resolution so `?next=` stays on **:3000** (gateway).
- **Widening guest `allowGuestPrefixes`** without review — security-sensitive; prefer narrow prefixes and document why (as with `/api` for Payload).
- Async auth reads (`getClaims()`, cookies/session access) in page trees without a surrounding **`<Suspense>`** in Next.js 16.

## Repo map

| Concern | Location |
|--------|----------|
| Supabase proxy + bridge redirect | `apps/author/src/lib/supabase/proxy.ts` |
| Bridge + cookie | `apps/author/src/app/api/auth/admin-payload-bridge/route.ts` |
| Token verify + strategies | `apps/author/src/auth/` |
| Shared guest policy / origin | `packages/gateway-auth/` |
| Cursor routing rules | `.cursor/rules/gateway-shell-routing.mdc` |

## Related env (typical)

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_JWT_SECRET` (if not using JWKS-only)
- `NEXT_PUBLIC_GATEWAY_ORIGIN`, gateway path envs, app `basePath`
- `PAYLOAD_SECRET`, DB URL for Payload

When extending to a new shell app, copy the **proxy + guest policy + sign-in URL** pattern from `apps/platform` / `apps/author`; do not enforce Supabase session only in the gateway app for routes owned by another Next app.
