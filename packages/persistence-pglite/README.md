# `@workspace/persistence-pglite`

The local database: schema, migrations, and the adapters implementing the
domain's persistence and search ports.

## Role in the architecture

Driven-adapter package, and the **only** workspace member that declares
`@electric-sql/pglite` (+ `-pgvector`). The database is a full Postgres in
WASM: relational rows, `bytea` for CRDT snapshot/update bytes,
`vector(384)` columns with an HNSW index for semantic search, `tsvector`
for full-text, and the first-party `live` extension for reactive queries.
Depends on `@workspace/domain`, `@workspace/doc-crdt` and `@workspace/embedding` (for
the chunking policy, so indexing and search cannot disagree about how a
document was split); nothing here imports UI.

Layout conventions: one subdirectory per aggregate (`document/`, `chat/`,
`search/`), adapters named `<Technology><Port>`
(`PgliteDocumentRepository`), migrations as numbered SQL files applied at
startup.

## Documents are CRDTs

`document.crdt-store.ts` owns the open documents and their persistence, and
both the document repository and the version store read through it so they
cannot disagree about what a document currently is.

What is stored, and why in that shape:

- **A journal of updates** — every save appends a small binary delta, so a
  crash between saves loses nothing.
- **A periodic full snapshot**, after which the journal it covers is deleted.
  Snapshotting keeps a cold load cheap; the order matters, because the
  journal is what would rebuild the document if the snapshot write never
  landed. A document is journal-only until its first snapshot, which is most
  of its early life — loading one must not require a snapshot to exist.
- **`document_content` beside them is a derived cache.** It exists so the
  sidebar and search never import a document to read its text. Delete it and
  the document is unharmed; delete the CRDT and its history is gone. An
  end-to-end test deletes the cache and requires the document anyway, because
  a cache would otherwise be indistinguishable from canonical storage.
- **Versions are frontiers** — positions in history, tens of bytes — not
  copies. That is what makes marking one cheap enough to do on every pause.

## Subpath exports

- `./react` — the live-query → React bridge (`useWatch`, built on
  `useSyncExternalStore`; the only place the app touches reactivity of
  this package). The core export also ships the framework-neutral
  `liveValue`, so any other integration can subscribe without React.
- `./testing` — in-memory doubles of the ports for unit tests

## Consumers

Only the app's composition root constructs adapters from this package.
