/*
 * change state, change probe and presence: what lets a device ask a space
 * once per heartbeat whether anything changed, instead of polling every
 * replicated table.
 *
 * why
 *   a device that keeps a space converged used to read every replicated
 *   table (and the document heads) on a fixed clock, whether or not anything
 *   had changed. here each space keeps, per kind of change, when it last
 *   happened: the graph (the seven replicated graph tables), a deletion in
 *   the graph (which a watermark pull cannot see and an inventory sweep
 *   must), and the document bodies. a device reads that one row and pulls
 *   only the kinds that moved since it last looked.
 *
 * the marks
 *   private.space_sync_state holds one row per space, created by the first
 *   change. private.sync_mark(space, kind) moves the kind's timestamp to
 *   clock_timestamp(), but only when the stored one is more than a second
 *   old: the write rate is then bounded at one per second per space and kind
 *   whatever the edit rate. the row is taken with `for update skip locked`:
 *   a writer that finds it locked skips, because the one holding it is
 *   marking the same instant, so a bulk import never serializes the other
 *   writers of the space on this row. a mark for a space that no longer
 *   exists is dropped, not inserted: a teardown deletes the space and its
 *   remaining rows in one transaction, and the marks those deletions leave
 *   run at commit, after the space is gone.
 *
 *   the triggers are constraint triggers, which postgres makes row-level,
 *   deferred to commit: a long transaction marks when it lands, not when it
 *   started, and clock_timestamp() is used rather than now() for the same
 *   reason. a device compares the marks with a few seconds of overlap, and
 *   a periodic full pass covers what lands outside it.
 *
 * the probe
 *   public.sync_probe(space) returns the space's row (zeros and nulls when
 *   there is none yet) and the server's own time of the answer, so a device
 *   compares the marks with times of the same clock rather than its own,
 *   which may be off by more than the overlap it allows. it answers an
 *   active member of the space, and the one message
 *   `space not found or not accessible` to anyone else and for anything that
 *   is not a space id, so it is no oracle for which spaces exist. it only
 *   reads, on purpose, so it can be served by a read replica later. the
 *   answer is "something of this kind changed in the space", never what:
 *   what a device may hold is still decided by the row policies when it
 *   pulls.
 *
 * presence
 *   public.sync_presence_beat(space) counts one beat per call in the
 *   current minute's bucket of private.sync_presence; one browser beats once
 *   a minute while one of its tabs shows the space. the first beat of a
 *   minute drops the space's buckets older than ten minutes, so no scheduler
 *   is needed. private.sync_active(space) is the number of browsers present:
 *   the beats of the last two buckets, halved. the beat is a separate call
 *   from the probe so the probe stays read-only.
 *
 * existing rows need nothing: the state row is created by the next change,
 * and a space with no row answers the probe as a space where nothing has
 * been seen yet.
 */

create table if not exists private.space_sync_state (
  space_id text primary key references public.spaces (id) on delete cascade,
  -- reserved for revoking channel access per space; always 0 here
  epoch integer not null default 0,
  graph_changed_at timestamptz,
  graph_signaled_at timestamptz,
  graph_deleted_at timestamptz,
  graph_delete_signaled_at timestamptz,
  documents_changed_at timestamptz,
  documents_signaled_at timestamptz
);

comment on table private.space_sync_state is
  'per space, when each kind of replicated change last happened; written by the sync_mark triggers, read by public.sync_probe';

-- no direct access: only the definer functions below, which run as the
-- owner, read or write it. the policy says so explicitly, and being
-- restrictive it stays closed even if a permissive one is added later.
alter table private.space_sync_state enable row level security;
revoke all on table private.space_sync_state from public, anon, authenticated;
drop policy if exists "space_sync_state no direct access" on private.space_sync_state;
create policy "space_sync_state no direct access"
  on private.space_sync_state
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create table if not exists private.sync_presence (
  space_id text not null references public.spaces (id) on delete cascade,
  bucket timestamptz not null,
  beats integer not null default 0,
  primary key (space_id, bucket)
);

comment on table private.sync_presence is
  'beats of present browsers per space and minute; written by public.sync_presence_beat, read by private.sync_active';

-- no direct access either: written by the beat, read by sync_active.
alter table private.sync_presence enable row level security;
revoke all on table private.sync_presence from public, anon, authenticated;
drop policy if exists "sync_presence no direct access" on private.sync_presence;
create policy "sync_presence no direct access"
  on private.sync_presence
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create or replace function private.sync_mark(p_space_id text, p_kind text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now constant timestamptz := clock_timestamp();
  v_fresh constant timestamptz := v_now - interval '1 second';
begin
  if p_kind not in ('graph', 'graph-delete', 'documents') then
    raise exception 'sync_mark: unknown kind %', p_kind;
  end if;
  -- the common case under a bulk write: the mark is already this second's,
  -- and nothing has to be written or locked.
  if exists (
    select 1
    from private.space_sync_state s
    where s.space_id = p_space_id
      and case p_kind
        when 'graph' then s.graph_changed_at >= v_fresh
        when 'graph-delete' then s.graph_changed_at >= v_fresh and s.graph_deleted_at >= v_fresh
        else s.documents_changed_at >= v_fresh
      end
  ) then
    return;
  end if;
  -- a space deleted in this very transaction gets no row: the deferred
  -- trigger would otherwise insert one at commit, after the space is gone,
  -- and fail the whole teardown.
  insert into private.space_sync_state (space_id)
  select p_space_id
  where exists (select 1 from public.spaces s where s.id = p_space_id)
  on conflict (space_id) do nothing;
  -- another writer holds the row: it is marking this instant; skip.
  perform 1
  from private.space_sync_state s
  where s.space_id = p_space_id
  for update skip locked;
  if not found then
    return;
  end if;
  if p_kind in ('graph', 'graph-delete') then
    update private.space_sync_state
       set graph_changed_at = v_now
     where space_id = p_space_id
       and (graph_changed_at is null or graph_changed_at < v_fresh);
  end if;
  if p_kind = 'graph-delete' then
    update private.space_sync_state
       set graph_deleted_at = v_now
     where space_id = p_space_id
       and (graph_deleted_at is null or graph_deleted_at < v_fresh);
  end if;
  if p_kind = 'documents' then
    update private.space_sync_state
       set documents_changed_at = v_now
     where space_id = p_space_id
       and (documents_changed_at is null or documents_changed_at < v_fresh);
  end if;
end;
$$;

revoke all on function private.sync_mark(text, text) from public, anon, authenticated;

create or replace function private.sync_mark_graph()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_mark(
    coalesce(new.space_id, old.space_id),
    case when tg_op = 'DELETE' then 'graph-delete' else 'graph' end
  );
  return null;
end;
$$;

revoke all on function private.sync_mark_graph() from public, anon, authenticated;

create or replace function private.sync_mark_documents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_mark(coalesce(new.space_id, old.space_id), 'documents');
  return null;
end;
$$;

revoke all on function private.sync_mark_documents() from public, anon, authenticated;

-- the seven replicated graph tables: three in public, four satellites in kb.
-- every one of them carries space_id.
drop trigger if exists sync_mark_graph on public.knowledge_resources;
create constraint trigger sync_mark_graph
  after insert or update or delete on public.knowledge_resources
  deferrable initially deferred
  for each row execute function private.sync_mark_graph();

drop trigger if exists sync_mark_graph on public.knowledge_edges;
create constraint trigger sync_mark_graph
  after insert or update or delete on public.knowledge_edges
  deferrable initially deferred
  for each row execute function private.sync_mark_graph();

drop trigger if exists sync_mark_graph on public.resource_user_state;
create constraint trigger sync_mark_graph
  after insert or update or delete on public.resource_user_state
  deferrable initially deferred
  for each row execute function private.sync_mark_graph();

drop trigger if exists sync_mark_graph on kb.resource_description;
create constraint trigger sync_mark_graph
  after insert or update or delete on kb.resource_description
  deferrable initially deferred
  for each row execute function private.sync_mark_graph();

drop trigger if exists sync_mark_graph on kb.resource_link;
create constraint trigger sync_mark_graph
  after insert or update or delete on kb.resource_link
  deferrable initially deferred
  for each row execute function private.sync_mark_graph();

drop trigger if exists sync_mark_graph on kb.media_blob;
create constraint trigger sync_mark_graph
  after insert or update or delete on kb.media_blob
  deferrable initially deferred
  for each row execute function private.sync_mark_graph();

drop trigger if exists sync_mark_graph on kb.resource_media_meta;
create constraint trigger sync_mark_graph
  after insert or update or delete on kb.resource_media_meta
  deferrable initially deferred
  for each row execute function private.sync_mark_graph();

-- document bodies: a pushed update moves the document's head, which is an
-- update of this row, so the update log needs no trigger of its own.
drop trigger if exists sync_mark_documents on public.crdt_documents;
create constraint trigger sync_mark_documents
  after insert or update or delete on public.crdt_documents
  deferrable initially deferred
  for each row execute function private.sync_mark_documents();

create or replace function public.sync_probe(p_space_id text)
returns table (
  epoch integer,
  graph_changed_at timestamptz,
  graph_deleted_at timestamptz,
  documents_changed_at timestamptz,
  probed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_entity_id_with_prefix(p_space_id, 'spc'), false)
     or not private.auth_user_active_in_space(p_space_id, (select auth.uid())) then
    -- one message for "no such space" and "not yours": the twin of the
    -- compaction rpc's `document not found or not accessible`.
    raise exception 'space not found or not accessible';
  end if;
  return query
    select coalesce(s.epoch, 0), s.graph_changed_at, s.graph_deleted_at, s.documents_changed_at, now()
    from (select 1) as one
    left join private.space_sync_state s on s.space_id = p_space_id;
end;
$$;

revoke all on function public.sync_probe(text) from public;
revoke all on function public.sync_probe(text) from anon;
grant execute on function public.sync_probe(text) to authenticated;

create or replace function public.sync_presence_beat(p_space_id text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_bucket constant timestamptz := date_trunc('minute', clock_timestamp());
  v_inserted boolean;
begin
  if not coalesce(public.is_entity_id_with_prefix(p_space_id, 'spc'), false)
     or not private.auth_user_active_in_space(p_space_id, (select auth.uid())) then
    raise exception 'space not found or not accessible';
  end if;
  insert into private.sync_presence as p (space_id, bucket, beats)
  values (p_space_id, v_bucket, 1)
  on conflict (space_id, bucket) do update set beats = p.beats + 1
  returning (xmax = 0) into v_inserted;
  -- the first beat of a minute: drop what is older than ten minutes.
  if v_inserted then
    delete from private.sync_presence
     where space_id = p_space_id
       and bucket < v_bucket - interval '10 minutes';
  end if;
end;
$$;

revoke all on function public.sync_presence_beat(text) from public;
revoke all on function public.sync_presence_beat(text) from anon;
grant execute on function public.sync_presence_beat(text) to authenticated;

create or replace function private.sync_active(p_space_id text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(ceil(sum(p.beats) / 2.0), 0)::integer
  from private.sync_presence p
  where p.space_id = p_space_id
    and p.bucket >= date_trunc('minute', clock_timestamp()) - interval '1 minute';
$$;

revoke all on function private.sync_active(text) from public, anon, authenticated;
