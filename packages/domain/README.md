# `@workspace/domain`

Entities, value objects, and the port interfaces of the local-first
document workbench.

## Role in the architecture

The innermost layer. Everything else points at this package; it points at
nothing but `@workspace/entity-id`. Its `package.json` deliberately
declares no UI framework, no editor, no database and no model SDK — a
domain file that reaches for one fails to resolve, which is what makes
the ports here interfaces rather than comments.

Ports are declared one per file with the `I` prefix and a `/** Port: … */`
header (`document.repository.ts`, `chat-message.repository.ts`,
`llm.gateway.ts`, …). Adapters implementing them live in the adapter
packages (persistence, local AI, embedding — ported alongside this
package) and are wired together only in the app's composition root.
Results cross port boundaries as `neverthrow` values, not exceptions.

## Key exports

- `newId()` / `now()` — id and clock helpers (plain functions by design;
  making them ports would be ceremony without a second implementation).
  Ids are minted through the shared `@workspace/entity-id` registry.
- `LOCAL_USER_ID` — the single local user of the frontend-only app
- Port interfaces (added stage by stage)

## Testing

`bun run test` runs colocated `*.spec.ts` files via vitest.
