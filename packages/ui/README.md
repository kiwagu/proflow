# UI (`@workspace/ui`)

The shared component library: shadcn/ui-based primitives (button, dialog,
table, form fields, …), composite components (data-table, confirm-dialog,
app-sidebar, command palette chrome), hooks, `globals.css`, and the shared
PostCSS/Tailwind setup.

## Role in the architecture

Presentation layer only — components take data and callbacks via props and
know nothing about routing, fetching, or app state. Consumers import through
subpaths (`@workspace/ui/components/*`, `@workspace/ui/hooks/*`,
`@workspace/ui/lib/*`) and pull in `globals.css` + `postcss.config` from here
so styling stays consistent across apps. New primitives are added via the
shadcn generator (`components.json`) and then adapted in place.

## Commands

```bash
bun run lint        # eslint (lint:strict for zero warnings)
bun run typecheck   # tsc --noEmit
bun run format      # prettier over **/*.{ts,tsx}
```
