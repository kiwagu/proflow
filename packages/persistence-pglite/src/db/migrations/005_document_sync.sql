-- Server-sync ledger, one row per document. Local bookkeeping only — the
-- server keeps no per-client state, so each replica records for itself how
-- far it has synced each document:
--
--   pushed_vv   the document's version vector as of the last update blob the
--               server acknowledged. The next push exports everything after
--               it. Advanced only after the insert succeeds — a crash between
--               export and ack re-sends the same span, which the CRDT
--               imports as a no-op (at-least-once by design).
--   pulled_seq  the server's delivery watermark this replica has caught up
--               to. A pull asks for rows with seq greater than this, in
--               order, and provably misses nothing.
create table document_sync (
  document_id text primary key references document(id) on delete cascade,
  pushed_vv bytea,
  pulled_seq bigint not null default 0,
  updated_at timestamptz not null default now()
);
