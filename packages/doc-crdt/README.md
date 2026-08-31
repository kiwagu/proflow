# `@workspace/doc-crdt`

A document as a CRDT: reflecting a serialized editor tree into Loro, reading
it back, and addressing past versions.

## Role in the architecture

Driven-adapter package, and the only workspace member that declares
`loro-crdt`. It depends on `@workspace/domain` and on nothing else — in
particular **not** on the editor library. The tree it reflects is described
structurally (`SerializedNode`: a `type`, optional `children`, optional
`text`, and arbitrary scalar props), which is what lets the whole format be
unit tested in Node with no browser and no DOM.

The CRDT is the canonical form of a document even though nothing syncs yet.
Adopting one later would be a data migration plus a rewrite of the editor
integration; adopting one now is only a choice of serialization. What it
pays for immediately is version history.

## Three things that cannot be added retroactively

They are therefore done from the first write, not deferred:

1. `setRecordTimestamp(true)` — history written without it has no times, and
   they cannot be filled in afterwards.
2. Identity travels in the commit **message**, not in the peer id (random per
   instance, so it identifies a session rather than a person) and not in
   `origin` (local-only, never travels with the document).
3. Every node carries a stable id, supplied by the editor. Ids are the
   identity key of the children list: without them a re-save reads as "every
   child replaced" and the history degenerates into full rewrites. A node
   without one is an error rather than a silent fallback to position.

## Key exports

- `DocumentCrdt` — `create` / `restore` / `fromSnapshot`, `commitTree`,
  `toTree`, `exportSnapshot`, `onLocalUpdate`, `importUpdates`, `frontiers`,
  `listChanges`, `readAt`, `revertTo`
- `SerializedNode` / `SerializedTree` — the structural contract
- `defaultIdOf` — reads the id the editor writes into node state

## Notes that shape the design

- **Snapshots are full, never shallow.** A shallow snapshot discards the
  operations before its frontier; history must survive locally because it is
  what named versions time-travel through.
- **A version is a frontier, not a change index.** Loro merges consecutive
  commits by the same author within its merge interval into one change, so
  the change log is coarser than the list of saves. Frontiers advance per
  commit and stay exact.
- **Restore appends inverse operations** (`revertTo`) rather than truncating,
  so the version restored away from remains reachable.
- **Importing is idempotent.** An operation the document already holds merges
  as a no-op, so `importUpdates` accepts everything newer than the caller's
  last look, unfiltered — retries and echoes cost nothing.

## Testing

`bun run test` in this package (or `bun run test:vitest` at the root). The
specs assert the property that matters most — that an edit costs a handful
of operations rather than a subtree rewrite, because a rewrite would still
produce a correct document with a useless history.
