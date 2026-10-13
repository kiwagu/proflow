-- The document's CRDT version as of its last local write, beside the row.
-- Compared with the sync ledger's pushed version, it says without opening
-- the CRDT whether this device holds changes the server may not have — a
-- start-up catch-up then opens only those documents.
alter table document add column version_vv bytea;
