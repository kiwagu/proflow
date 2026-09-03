# Gateway auth (`@workspace/gateway-auth`)

Authentication and navigation utilities shared by the gateway-facing apps:
Supabase client factories (browser + server), active-space resolution and its
cookie, safe return-path handling, password recovery, guest access, and
site-origin helpers.

## Role in the architecture

Everything about "who is signed in and where do they land" that more than one
app needs lives here, exported as narrow subpaths (`./supabase/server`,
`./resolve-active-space`, `./safe-next-path`, …) so each consumer pulls only
what it uses. Path helpers (`path-within-base`, `safe-next-path`,
`gateway-return-path`) exist to keep every redirect validated in one place
instead of ad hoc per app.

## Commands

```bash
bun run test        # vitest
bun run lint        # eslint (lint:strict for zero warnings)
bun run typecheck   # tsc --noEmit
bun run format      # prettier
```
