# Document sync (`@workspace/doc-sync`)

Push/pull synchronization of CRDT document updates between a local replica and
a server: a ledger/journal over PGlite records what has been sent and seen, and
a transport moves the update bytes.

## Role in the architecture

Sits between `@workspace/doc-crdt` (which owns the document format) and the
persistence/transport layers. The sync engine (`createDocumentSync`) is written
against two narrow ports:

- **Ledger/journal** — `createPgliteLedger` / `createPgliteJournal` keep sync
  heads and outbound tails in the local PGlite database.
- **Transport** — `createSupabaseTransport` exchanges update rows with the
  server; `toByteaHex` / `fromByteaHex` handle the bytea wire encoding.

`src/testing/` provides an in-memory replica and a server stand-in so the
whole push/pull protocol is unit-tested in Node without a real backend.

## Commands

```bash
bun run test        # vitest
bun run lint        # eslint (lint:strict for zero warnings)
bun run typecheck   # tsc --noEmit
bun run format      # prettier
```
