-- Space-level sync cursor: how far this replica has read the server's
-- document heads for one space. The per-document ledger (document_sync)
-- says what was pulled; this says which documents still need asking.
-- Backed off by an overlap window on read, so clock ties cannot skip a head.
create table document_sync_space (
  space_id text primary key,
  heads_cursor timestamptz,
  updated_at timestamptz not null default now()
);
