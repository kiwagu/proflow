/*
 * space signals: a change in a space reaches the browsers that keep it as
 * one small broadcast per space and throttle window, instead of one row
 * event per changed row and per subscriber.
 *
 * what a signal is, and is not
 *   a signal says "something of kind K changed in this space" and how long
 *   the current throttle window is: `changed {kind, window_ms}` with kind
 *   `graph`, `graph-delete` or `documents`. it never carries content, ids or
 *   who changed what. a browser that receives it pulls over HTTP, where the
 *   row policies decide what it may hold; the signal is only a kick, and the
 *   HTTP log stays the authority.
 *
 * where it goes
 *   on the private broadcast topic `space:<space id>:<epoch>`, the epoch
 *   being private.space_sync_state.epoch (0 until a later change moves it
 *   when a membership narrows). a browser learns the epoch from the change
 *   probe.
 *
 * the throttle window
 *   private.sync_mark already writes a kind's mark at most once a second. it
 *   now also signals, leading edge: the first change of a window is
 *   signaled at once, later ones in the same window are not, and the
 *   browser's own follow-up pull, one window later, covers them. each kind
 *   keeps its own stamp (graph_signaled_at, graph_delete_signaled_at,
 *   documents_signaled_at). a deletion signals `graph-delete` only, and
 *   stamps the graph signal too: the sweep it asks for pulls every table
 *   first.
 *
 *   the window is computed from presence against a message budget: a
 *   broadcast to n listeners costs about n messages, so a space with n
 *   browsers present signals at most once per 2n / space_budget seconds,
 *   and the whole deployment at most once per 2N / global_budget seconds
 *   for N browsers present anywhere, whichever is longer, clamped to
 *   [window_min_ms, window_max_ms]. at the default budgets: 20 present →
 *   1 s, 1 000 → 5 s, 5 000 → 25 s. a space nobody is present in gets the
 *   floor. the budgets live in private.sync_config, editable with sql.
 *
 * one emit point
 *   every signal leaves the database through private.sync_emit. today it is
 *   realtime's own broadcast insert (`realtime.send`); a queue drained by
 *   stateless publishers can replace its body without touching a trigger,
 *   a topic or a client. realtime.send is not security definer: its insert
 *   into realtime.messages runs as the caller, which is sync_emit's owner
 *   (sync_emit is security definer), a role that may insert there whatever
 *   the row policies on that table say.
 *
 * a signal that cannot be sent never fails the write
 *   realtime.send swallows its own insert errors with a warning (a missing
 *   daily partition, for one). sync_mark wraps the emit in its own
 *   `begin … exception when others then raise warning … end` as well, so
 *   no future body of sync_emit can fail a write either. a lost signal
 *   costs latency, never data: the change is marked, the next probe sees
 *   it, the periodic full pass reads everything.
 *
 * who may listen
 *   private.sync_can_join(topic) is true for `space:<id>:<epoch>` when the
 *   caller is an active member of the space and the epoch is the space's
 *   current one, and false for anything else, never an error. the select
 *   policy on realtime.messages asks it for the topic of the join, so
 *   realtime admits a private join only to members. a member removed from
 *   the space cannot join again; a subscription already open lasts until
 *   the client's next token refresh, which is when realtime checks the
 *   policy again. it learns nothing in between: a signal carries no content
 *   and every pull it prompts is fenced by the row policies.
 *
 * nobody signed in can publish
 *   there is no insert policy on realtime.messages for anyone signed in: the
 *   database is the only writer of a space topic.
 *
 * the row-change publication goes
 *   crdt_documents, knowledge_resources and knowledge_edges leave the
 *   supabase_realtime publication: realtime evaluated the row policies of
 *   every changed row for every subscriber, and every event made each of
 *   them pull everything. the space signal replaces it. clients built
 *   before this change, which listened for row changes, hear nothing more
 *   and converge on their heartbeat; there is no compatibility path.
 *
 * presence per person, capped
 *   the window is only as honest as the presence count. presence is now kept
 *   per space, minute and person, and a person's beats in one minute count
 *   at most four: a browser beats once a minute, a person may run a few,
 *   and a loop calling the beat cannot widen the window beyond that. the
 *   rows of the previous shape are dropped (they are a minute's worth of
 *   counters, rebuilt by the next beats).
 */

create table if not exists private.sync_config (
  key text primary key,
  value numeric not null
);

comment on table private.sync_config is
  'tunables of the space signal: the message budgets and the bounds of the throttle window; owner-editable with sql';

insert into private.sync_config (key, value) values
  ('space_budget_msg_s', 400),
  ('global_budget_msg_s', 2000),
  ('window_min_ms', 1000),
  ('window_max_ms', 30000),
  -- the largest document update a document topic will carry inline
  ('doc_payload_max_bytes', 204800)
on conflict (key) do nothing;

alter table private.sync_config enable row level security;
revoke all on table private.sync_config from public, anon, authenticated;
drop policy if exists "sync_config no direct access" on private.sync_config;
create policy "sync_config no direct access"
  on private.sync_config
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop table if exists private.sync_presence;
create table private.sync_presence (
  space_id text not null references public.spaces (id) on delete cascade,
  bucket timestamptz not null,
  -- the auth user, not an entity id
  user_id uuid not null,
  beats integer not null default 0,
  primary key (space_id, bucket, user_id)
);

-- the deployment-wide count reads the last two minutes of every space
create index sync_presence_bucket_idx on private.sync_presence (bucket);

comment on table private.sync_presence is
  'beats of present browsers per space, minute and person, at most four a minute each; written by public.sync_presence_beat, read by private.sync_active and private.sync_active_all';

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

create or replace function public.sync_presence_beat(p_space_id text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_bucket constant timestamptz := date_trunc('minute', clock_timestamp());
  v_user constant uuid := (select auth.uid());
  v_inserted boolean;
begin
  if not coalesce(public.is_entity_id_with_prefix(p_space_id, 'spc'), false)
     or not private.auth_user_active_in_space(p_space_id, v_user) then
    raise exception 'space not found or not accessible';
  end if;
  insert into private.sync_presence as p (space_id, bucket, user_id, beats)
  values (p_space_id, v_bucket, v_user, 1)
  on conflict (space_id, bucket, user_id) do update set beats = least(p.beats + 1, 4)
  returning (xmax = 0) into v_inserted;
  -- a person's first beat of a minute: drop what is older than ten minutes.
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

create or replace function private.sync_active_all()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(ceil(sum(p.beats) / 2.0), 0)::integer
  from private.sync_presence p
  where p.bucket >= date_trunc('minute', clock_timestamp()) - interval '1 minute';
$$;

revoke all on function private.sync_active_all() from public, anon, authenticated;

create or replace function private.sync_window_ms(p_space_id text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select
      (select value from private.sync_config where key = 'space_budget_msg_s') as space_budget,
      (select value from private.sync_config where key = 'global_budget_msg_s') as global_budget,
      (select value from private.sync_config where key = 'window_min_ms') as window_min,
      (select value from private.sync_config where key = 'window_max_ms') as window_max
  )
  select least(c.window_max, greatest(c.window_min, ceil(1000 * greatest(
           2.0 * private.sync_active(p_space_id) / c.space_budget,
           2.0 * private.sync_active_all() / c.global_budget))))::integer
  from c;
$$;

revoke all on function private.sync_window_ms(text) from public, anon, authenticated;

create or replace function private.sync_emit(p_topic text, p_event text, p_payload jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform realtime.send(p_payload, p_event, p_topic, true);
end;
$$;

revoke all on function private.sync_emit(text, text, jsonb) from public, anon, authenticated;

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
  v_marked boolean := false;
  v_state private.space_sync_state;
  v_window integer;
  v_since timestamptz;
begin
  if p_kind not in ('graph', 'graph-delete', 'documents') then
    raise exception 'sync_mark: unknown kind %', p_kind;
  end if;
  -- the common case under a bulk write: the mark is already this second's,
  -- and nothing has to be written, locked or signaled.
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
    v_marked := found;
  end if;
  if p_kind = 'graph-delete' then
    -- what a deletion signals is the deletion; a graph mark alone is a
    -- second deletion inside the second, which the first one's signal covers.
    update private.space_sync_state
       set graph_deleted_at = v_now
     where space_id = p_space_id
       and (graph_deleted_at is null or graph_deleted_at < v_fresh);
    v_marked := found;
  end if;
  if p_kind = 'documents' then
    update private.space_sync_state
       set documents_changed_at = v_now
     where space_id = p_space_id
       and (documents_changed_at is null or documents_changed_at < v_fresh);
    v_marked := found;
  end if;
  if not v_marked then
    return;
  end if;

  -- leading edge: the first change of a window is signaled at once, the rest
  -- of the window is silent; the browser's follow-up pull covers it.
  select * into v_state from private.space_sync_state where space_id = p_space_id;
  v_window := private.sync_window_ms(p_space_id);
  v_since := v_now - make_interval(secs => v_window / 1000.0);
  if p_kind = 'graph' then
    if v_state.graph_signaled_at >= v_since then
      return;
    end if;
    update private.space_sync_state set graph_signaled_at = v_now where space_id = p_space_id;
  elsif p_kind = 'graph-delete' then
    if v_state.graph_delete_signaled_at >= v_since then
      return;
    end if;
    update private.space_sync_state
       set graph_delete_signaled_at = v_now, graph_signaled_at = v_now
     where space_id = p_space_id;
  else
    if v_state.documents_signaled_at >= v_since then
      return;
    end if;
    update private.space_sync_state set documents_signaled_at = v_now where space_id = p_space_id;
  end if;
  begin
    perform private.sync_emit(
      'space:' || p_space_id || ':' || v_state.epoch,
      'changed',
      jsonb_build_object('kind', p_kind, 'window_ms', v_window));
  exception when others then
    -- the write goes through; the probe and the full pass still converge.
    raise warning 'space signal not sent for %: %', p_space_id, sqlerrm;
  end;
end;
$$;

revoke all on function private.sync_mark(text, text) from public, anon, authenticated;

create or replace function private.sync_can_join(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[];
  v_space text;
begin
  if p_topic is null then
    return false;
  end if;
  v_parts := string_to_array(p_topic, ':');
  if cardinality(v_parts) <> 3 or v_parts[1] <> 'space' then
    return false;
  end if;
  v_space := v_parts[2];
  if not coalesce(public.is_entity_id_with_prefix(v_space, 'spc'), false)
     or v_parts[3] !~ '^[0-9]{1,9}$' then
    return false;
  end if;
  if not private.auth_user_active_in_space(v_space, (select auth.uid())) then
    return false;
  end if;
  return v_parts[3]::integer = coalesce(
    (select s.epoch from private.space_sync_state s where s.space_id = v_space), 0);
end;
$$;

-- the row policy below runs it as the joining user
revoke all on function private.sync_can_join(text) from public, anon;
grant execute on function private.sync_can_join(text) to authenticated;

-- members listen to the topics they may join; nothing lets anyone signed in
-- publish.
drop policy if exists "sync subscribers read their topics" on realtime.messages;
create policy "sync subscribers read their topics"
  on realtime.messages
  for select
  to authenticated
  using (extension = 'broadcast' and private.sync_can_join(realtime.topic()));

do $$
declare
  v_table text;
begin
  foreach v_table in array array['crdt_documents', 'knowledge_resources', 'knowledge_edges'] loop
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime drop table public.%I', v_table);
    end if;
  end loop;
end;
$$;
