# Std (`@workspace/std`)

Small, **framework-agnostic** primitives shared across layers — no React, no
TanStack, no DB. Anything importable from a Next.js app, a Node worker/service, or
a Payload hook alike lives here.

## Why a separate package

Some behaviour (e.g. how we order text) must be **identical** on the front end and
the back end. Keeping the canonical, dependency-light implementation here lets every
layer import the same logic without depending on a UI package. The principle is
**one contract, layer-specific adapters**: this package holds the policy; each layer
wraps it (the UI builds a TanStack `sortingFn` over it; the data layer is expected to
mirror it in SQL when it owns the order).

## Contents

### `sort`

Human-friendly text ordering — case- and accent-insensitive, locale-aware, and
numeric-natural (`"World2"` before `"World10"`), instead of raw UTF-8 code-point
order.

```ts
import { compareText, byText } from '@workspace/std';

items.sort(byText((n) => n.title));
compareText('apple', 'Apple'); // 0 — case-insensitive
```

The UI adapter `textSortingFn` (a TanStack `sortingFn`) lives in
`@workspace/ui/lib/sort`, which re-exports `compareText` / `byText` from here.

> **Cross-layer note:** when a server owns a list's default order (Postgres
> `ORDER BY`), it must match this contract — plain Postgres collation does **not**.
> Mirror it with an ICU collation (case-insensitive, `numeric`). Deferred until the
> server-ordering / pagination work; this comparator is the canonical JS reference.

## Conventions

- Zero runtime dependencies — keep it that way (it underpins both layers).
- Built to `dist` (consumed compiled, like the other shared packages).
