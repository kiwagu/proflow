# Graph sync (`@workspace/graph-sync`)

Push/pull synchronization of knowledge-graph rows between a local replica and
a server: a journal records what has been sent, and a transport moves the row
data over Supabase.

## Role in the architecture

Sits between the local graph replica (`@workspace/persistence-pglite`) and the
server. The sync engine (`createGraphSync`) is written against narrow ports:

- **Replica** — reads and applies rows for the tables in
  `GRAPH_SYNC_TABLE_DESCRIPTORS`.
- **Transport** — `createSupabaseGraphRowTransport` exchanges row writes with
  the server.

`src/testing/` provides an in-memory replica and a server stand-in so the
whole push/pull protocol is unit-tested in Node without a real backend.
