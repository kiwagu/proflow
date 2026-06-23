-- ---------------------------------------------------------------------------
-- kb.resource_activity — event_id dedupe index: partial -> FULL unique.
--
-- The activity consumer appends a body event with
--   insert ... on conflict (event_id) do nothing
-- (supabase-js `upsert(..., { onConflict: 'event_id', ignoreDuplicates: true })`).
-- The original index was PARTIAL (`where event_id is not null`), which Postgres
-- will NOT use to infer a bare `on conflict (event_id)` — the statement would have
-- to repeat the predicate (`... where event_id is not null`), which supabase-js
-- does not emit. The consumer therefore failed every append with
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification".
--
-- Fix: a FULL unique index on event_id. event_id is nullable and NULLS are DISTINCT
-- by default, so the pg-trigger and open paths (event_id null) still coexist freely,
-- while non-null NATS event_ids dedupe — and `on conflict (event_id)` now infers
-- this index. Forward-only; same index name.
-- ---------------------------------------------------------------------------

drop index if exists kb.kb_resource_activity_event_id_key;

create unique index kb_resource_activity_event_id_key
  on kb.resource_activity (event_id);

comment on index kb.kb_resource_activity_event_id_key is
  'Full unique index on event_id for the consumer''s idempotent append (on conflict (event_id) do nothing). NULLS DISTINCT: the pg-trigger/open paths (event_id null) coexist; only non-null NATS Nats-Msg-Ids dedupe.';
