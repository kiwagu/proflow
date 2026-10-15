-- Probe for the change state, the change probe and presence.
--
-- WHAT THIS IS FOR
--   A device asks the space "did anything of this kind change since my last
--   look" once per heartbeat instead of polling every replicated table. The
--   answer is kept by row triggers on those tables (one write per second per
--   space and kind at most) and read by public.sync_probe; browsers that are
--   present beat public.sync_presence_beat once a minute. A change also
--   signals the space's listeners, at most once per throttle window, on a
--   topic only its members may join. This script pins what those promise:
--   who may ask, what a write leaves behind, the one-second gate, a space
--   teardown that still holds rows, the presence count with its per-person
--   cap and lazy cleanup, the throttle window against the message budgets,
--   the signal and its throttle, a signal that cannot be sent, who may join
--   a topic, that nobody signed in can publish, and that row changes are no
--   longer published.
--
-- HOW TO RUN (against a stand, never production)
--   docker exec -i <db-container> psql -U postgres -d postgres \
--     -f /dev/stdin < supabase/tests/sync_traffic.sql
--
-- SAFETY
--   One transaction, ending in ROLLBACK; refusals are caught in their own
--   subtransactions.
--
-- FIXTURE
--   one organization with four spaces; a member of all four, a second
--   member of the third only, and a stranger to all. The first space
--   starts with no replicated rows at all, so its change state does not
--   exist until the first write; the third is where the space signal is
--   watched, the fourth only lends presence to the deployment-wide budget.

begin;

-- The mark triggers are deferred to commit in production, so a long
-- transaction marks at the moment it lands. Here the whole script is one
-- transaction that is rolled back, so they are made to fire at the end of
-- each statement instead: that is what makes a mark observable at all.
set constraints all immediate;

create temporary table st_ids (k text primary key, v text);

do $fixture$
declare
  v_org text; v_a text; v_b text; v_c text; v_d text;
  u_m uuid := gen_random_uuid();
  u_x uuid := gen_random_uuid();
  u_2 uuid := gen_random_uuid();
  r_member text;
begin
  insert into public.organizations (name, slug) values ('ST Org', 'st-org-' || substr(md5(random()::text),1,8)) returning id into v_org;
  insert into public.spaces (organization_id, name, slug) values (v_org, 'ST A', 'st-a-' || substr(md5(random()::text),1,8)) returning id into v_a;
  insert into public.spaces (organization_id, name, slug) values (v_org, 'ST B', 'st-b-' || substr(md5(random()::text),1,8)) returning id into v_b;
  insert into public.spaces (organization_id, name, slug) values (v_org, 'ST C', 'st-c-' || substr(md5(random()::text),1,8)) returning id into v_c;
  insert into public.spaces (organization_id, name, slug) values (v_org, 'ST D', 'st-d-' || substr(md5(random()::text),1,8)) returning id into v_d;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  select x, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'st-'||x||'@st.invalid', '', now(), now(), now()
  from unnest(array[u_m, u_x, u_2]) as x;
  insert into public.profiles (user_id, email, display_name)
  select x, 'st-'||x||'@st.invalid', 'ST' from unnest(array[u_m, u_x, u_2]) as x
  on conflict (user_id) do nothing;

  -- u_x is a member of no space.
  insert into public.space_memberships (space_id, user_id, status) values
    (v_a, u_m, 'active'), (v_b, u_m, 'active'), (v_c, u_m, 'active'), (v_c, u_2, 'active'), (v_d, u_m, 'active');
  select id into r_member from public.roles where key='member' and role_kind='system' and owner_organization_id is null and archived_at is null limit 1;
  insert into public.user_role (user_id, role_id, space_id, organization_id) values
    (u_m, r_member, v_a, null), (u_m, r_member, v_b, null), (u_m, r_member, v_c, null), (u_2, r_member, v_c, null), (u_m, r_member, v_d, null);

  insert into st_ids values ('org', v_org), ('a', v_a), ('b', v_b), ('c', v_c), ('d', v_d),
    ('member', u_m::text), ('stranger', u_x::text), ('second', u_2::text);
end
$fixture$;

create or replace function pg_temp.st_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'role','authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.st_check(p_label text, p_ok boolean, p_detail text default null) returns void language plpgsql as $$
begin
  raise notice '% | % %', case when p_ok then 'PASS' else '*** FAIL ***' end, p_label, coalesce(p_detail, '');
end $$;

create or replace function pg_temp.st_id(p_key text) returns text language sql as $$
  select v from st_ids where k = p_key
$$;

-- The refusal a call met as a user, or null when it went through.
create or replace function pg_temp.st_refusal(p_user uuid, p_sql text) returns text language plpgsql as $$
begin
  perform pg_temp.st_as(p_user);
  execute p_sql;
  reset role;
  return null;
exception when others then
  reset role;
  return sqlerrm;
end $$;

create or replace function pg_temp.st_state(p_space text) returns private.space_sync_state language sql as $$
  select * from private.space_sync_state where space_id = p_space
$$;

-- Moves every mark of a space two seconds into the past: the next write is
-- then outside the one-second gate and must move it forward again.
create or replace function pg_temp.st_age(p_space text) returns void language sql as $$
  update private.space_sync_state
     set graph_changed_at = graph_changed_at - interval '2 seconds',
         graph_deleted_at = graph_deleted_at - interval '2 seconds',
         documents_changed_at = documents_changed_at - interval '2 seconds'
   where space_id = p_space
$$;

do $probe$
declare
  v_a text := pg_temp.st_id('a');
  v_b text := pg_temp.st_id('b');
  u_m uuid := pg_temp.st_id('member')::uuid;
  u_x uuid := pg_temp.st_id('stranger')::uuid;
  refused text;
  r record;
  before private.space_sync_state;
  after private.space_sync_state;
  t0 timestamptz;
  n1 text; n2 text; n3 text; d text; b text;
  cnt integer;
begin
  -- S1 who may ask
  refused := pg_temp.st_refusal(u_x, format('select * from public.sync_probe(%L)', v_a));
  perform pg_temp.st_check('S1 a stranger is refused with the one message',
    refused = 'space not found or not accessible', refused);
  perform pg_temp.st_as(u_m);
  select count(*) into cnt from public.sync_probe(v_a);
  select * into r from public.sync_probe(v_a);
  reset role;
  perform pg_temp.st_check('S1 a member of a space never written gets one row of zeros',
    cnt = 1 and r.epoch = 0 and r.graph_changed_at is null and r.graph_deleted_at is null and r.documents_changed_at is null,
    format('rows=%s row=%s', cnt, r));
  perform pg_temp.st_check('S1 the answer carries the server''s time of it',
    r.probed_at = now(), format('%s', r.probed_at));
  perform pg_temp.st_check('S1 asking leaves no state row behind', (pg_temp.st_state(v_a)).space_id is null);

  -- S2 a malformed space id is no oracle
  refused := pg_temp.st_refusal(u_m, 'select * from public.sync_probe(''not-an-id'')');
  perform pg_temp.st_check('S2 not an id: the same message',
    refused = 'space not found or not accessible', refused);
  refused := pg_temp.st_refusal(u_m, format('select * from public.sync_probe(%L)', public.entity_id_generate('usr')));
  perform pg_temp.st_check('S2 an id of another kind: the same message',
    refused = 'space not found or not accessible', refused);
  refused := pg_temp.st_refusal(u_m, 'select * from public.sync_probe(null)');
  perform pg_temp.st_check('S2 no id: the same message',
    refused = 'space not found or not accessible', refused);

  -- S3 an insert marks the graph
  t0 := clock_timestamp();
  insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
  values (v_a, 'text', 'ST one', 'space', u_m, u_m) returning id into n1;
  after := pg_temp.st_state(v_a);
  perform pg_temp.st_check('S3 an insert sets graph_changed_at',
    after.graph_changed_at is not null and after.graph_changed_at >= t0 - interval '1 second',
    format('t0=%s state=%s', t0, after));
  perform pg_temp.st_check('S3 an insert is not a delete', after.graph_deleted_at is null);
  perform pg_temp.st_as(u_m);
  select * into r from public.sync_probe(v_a);
  reset role;
  perform pg_temp.st_check('S3 the probe answers the mark',
    r.graph_changed_at = after.graph_changed_at, format('%s', r));

  -- S4 a delete marks the graph and the deletion
  perform pg_temp.st_age(v_a);
  before := pg_temp.st_state(v_a);
  delete from public.knowledge_resources where id = n1;
  after := pg_temp.st_state(v_a);
  perform pg_temp.st_check('S4 a delete sets graph_deleted_at',
    after.graph_deleted_at is not null, format('%s', after));
  perform pg_temp.st_check('S4 a delete bumps graph_changed_at',
    after.graph_changed_at > before.graph_changed_at, format('before=%s after=%s', before.graph_changed_at, after.graph_changed_at));

  -- S5 a document marks documents and only documents
  insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
  values (v_a, 'text', 'ST two', 'space', u_m, u_m) returning id into n2;
  d := public.entity_id_generate('doc');
  update public.knowledge_resources set body_ref = jsonb_build_object('doc_id', d) where id = n2;
  before := pg_temp.st_state(v_a);
  insert into public.crdt_documents (id, space_id, created_by, resource_id) values (d, v_a, u_m, n2);
  after := pg_temp.st_state(v_a);
  perform pg_temp.st_check('S5 a document sets documents_changed_at',
    after.documents_changed_at is not null, format('%s', after));
  perform pg_temp.st_check('S5 a document leaves the graph marks alone',
    after.graph_changed_at is not distinct from before.graph_changed_at
      and after.graph_deleted_at is not distinct from before.graph_deleted_at);
  perform pg_temp.st_age(v_a);
  before := pg_temp.st_state(v_a);
  insert into public.crdt_updates (doc_id, bytes, writer, created_by)
  values (d, '\x01'::bytea, public.entity_id_generate('wrt'), u_m);
  after := pg_temp.st_state(v_a);
  perform pg_temp.st_check('S5 a pushed update moves the head and marks documents',
    after.documents_changed_at > before.documents_changed_at);

  -- S6 the one-second gate
  perform pg_temp.st_age(v_a);
  insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
  values (v_a, 'text', 'ST three', 'space', u_m, u_m) returning id into n3;
  before := pg_temp.st_state(v_a);
  insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
  values (v_a, 'text', 'ST four', 'space', u_m, u_m);
  after := pg_temp.st_state(v_a);
  perform pg_temp.st_check('S6 a second write inside the second leaves one mark',
    after.graph_changed_at = before.graph_changed_at, format('before=%s after=%s', before.graph_changed_at, after.graph_changed_at));
  update private.space_sync_state set graph_changed_at = graph_changed_at - interval '2 seconds' where space_id = v_a;
  before := pg_temp.st_state(v_a);
  insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
  values (v_a, 'text', 'ST five', 'space', u_m, u_m);
  after := pg_temp.st_state(v_a);
  perform pg_temp.st_check('S6 a write after the second moves the mark forward',
    after.graph_changed_at > before.graph_changed_at, format('before=%s after=%s', before.graph_changed_at, after.graph_changed_at));

  -- S7 the satellites in schema kb mark the graph too
  perform pg_temp.st_age(v_a);
  before := pg_temp.st_state(v_a);
  insert into kb.resource_description (node_id, space_id, body, created_by) values (n3, v_a, 'about', u_m);
  after := pg_temp.st_state(v_a);
  perform pg_temp.st_check('S7 kb.resource_description marks the graph',
    after.graph_changed_at > before.graph_changed_at);
  perform pg_temp.st_age(v_a);
  before := pg_temp.st_state(v_a);
  b := public.entity_id_generate('kmb');
  insert into kb.media_blob (id, space_id, storage_path, mime_type, size_bytes, uploaded_by)
  values (b, v_a, 'spaces/' || v_a || '/kb/blobs/' || b || '/st.png', 'image/png', 1, u_m);
  after := pg_temp.st_state(v_a);
  perform pg_temp.st_check('S7 kb.media_blob marks the graph',
    after.graph_changed_at > before.graph_changed_at);

  -- S9 presence
  refused := pg_temp.st_refusal(u_x, format('select public.sync_presence_beat(%L)', v_a));
  perform pg_temp.st_check('S9 a stranger cannot beat',
    refused = 'space not found or not accessible', refused);
  perform pg_temp.st_as(u_m);
  perform public.sync_presence_beat(v_a);
  perform public.sync_presence_beat(v_a);
  reset role;
  select count(*) into cnt from private.sync_presence where space_id = v_a;
  perform pg_temp.st_check('S9 two beats in one minute are one row of two',
    cnt = 1 and (select beats from private.sync_presence where space_id = v_a) = 2, format('rows=%s', cnt));
  perform pg_temp.st_check('S9 two beats count one browser',
    private.sync_active(v_a) = 1, format('active=%s', private.sync_active(v_a)));
  insert into private.sync_presence (space_id, bucket, user_id, beats)
  values (v_a, date_trunc('minute', clock_timestamp()) - interval '1 minute', u_m, 4);
  perform pg_temp.st_check('S9 the previous minute counts too',
    private.sync_active(v_a) = 3, format('active=%s', private.sync_active(v_a)));
  -- the first beat of a new minute cleans up: the current minute is taken
  -- away so the next beat is the first of its minute again.
  insert into private.sync_presence (space_id, bucket, user_id, beats)
  values (v_a, date_trunc('minute', clock_timestamp()) - interval '11 minutes', u_m, 3);
  delete from private.sync_presence where space_id = v_a and bucket = date_trunc('minute', clock_timestamp());
  perform pg_temp.st_as(u_m);
  perform public.sync_presence_beat(v_a);
  reset role;
  perform pg_temp.st_check('S9 the first beat of a minute drops what is older than ten minutes',
    not exists (select 1 from private.sync_presence where space_id = v_a and bucket < date_trunc('minute', clock_timestamp()) - interval '10 minutes'));
  perform pg_temp.st_check('S9 and keeps the previous minute',
    exists (select 1 from private.sync_presence where space_id = v_a and bucket = date_trunc('minute', clock_timestamp()) - interval '1 minute'));
  perform pg_temp.st_check('S9 a member reads nothing of presence directly',
    pg_temp.st_refusal(u_m, 'select * from private.sync_presence') is not null);
  perform pg_temp.st_check('S9 nor of the change state',
    pg_temp.st_refusal(u_m, 'select * from private.space_sync_state') is not null);

  -- S10 a malformed id cannot beat
  refused := pg_temp.st_refusal(u_m, 'select public.sync_presence_beat(''not-an-id'')');
  perform pg_temp.st_check('S10 not an id: the same message',
    refused = 'space not found or not accessible', refused);

  -- S8 a space torn down with rows still in it. Content is purged first by
  -- an organization teardown (its audit trail needs the space); what is left
  -- (bodies, media records) goes with the space in the cascade, and the
  -- marks those deletions leave are fired at commit, after the space is gone.
  insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
  values (v_b, 'text', 'ST B one', 'space', u_m, u_m) returning id into n1;
  d := public.entity_id_generate('doc');
  insert into public.crdt_documents (id, space_id, created_by, resource_id) values (d, v_b, u_m, n1);
  b := public.entity_id_generate('kmb');
  insert into kb.media_blob (id, space_id, storage_path, mime_type, size_bytes, uploaded_by)
  values (b, v_b, 'spaces/' || v_b || '/kb/blobs/' || b || '/st.png', 'image/png', 1, u_m);
  delete from public.knowledge_resources where id = n1;
  perform pg_temp.st_check('S8 the space to tear down has a state row', (pg_temp.st_state(v_b)).space_id is not null);
  begin
    set constraints all deferred;
    delete from public.spaces where id = v_b;
    -- what commit does: the pending marks fire now
    set constraints all immediate;
    perform pg_temp.st_check('S8 the teardown commits', true);
  exception when others then
    perform pg_temp.st_check('S8 the teardown commits', false, sqlerrm);
  end;
  perform pg_temp.st_check('S8 and leaves no state row', (pg_temp.st_state(v_b)).space_id is null);
  perform pg_temp.st_check('S8 nor presence', not exists (select 1 from private.sync_presence where space_id = v_b));

  -- S11 grants
  perform pg_temp.st_check('S11 anon cannot probe',
    not has_function_privilege('anon', 'public.sync_probe(text)', 'execute'));
  perform pg_temp.st_check('S11 a signed-in caller can probe',
    has_function_privilege('authenticated', 'public.sync_probe(text)', 'execute'));
  perform pg_temp.st_check('S11 anon cannot beat',
    not has_function_privilege('anon', 'public.sync_presence_beat(text)', 'execute'));
  perform pg_temp.st_check('S11 a signed-in caller can beat',
    has_function_privilege('authenticated', 'public.sync_presence_beat(text)', 'execute'));
  perform pg_temp.st_check('S11 nobody signed in calls the internals',
    not has_function_privilege('authenticated', 'private.sync_mark(text, text)', 'execute')
      and not has_function_privilege('authenticated', 'private.sync_active(text)', 'execute')
      and not has_function_privilege('anon', 'private.sync_mark(text, text)', 'execute'));
  perform pg_temp.st_check('S11 the probe only reads',
    (select provolatile = 's' from pg_proc where oid = 'public.sync_probe(text)'::regprocedure));
end
$probe$;

-- Counts the space signals (`changed` broadcasts) inserted on a topic,
-- optionally of one kind. Inserted by realtime.send, they are visible here
-- before commit; the rollback at the end sends none of them.
create or replace function pg_temp.st_signals(p_topic text, p_kind text default null) returns integer language sql as $$
  select count(*)::integer from realtime.messages
   where topic = p_topic and event = 'changed' and extension = 'broadcast'
     and (p_kind is null or payload->>'kind' = p_kind)
$$;

-- Whether a user may join a topic, as the join check asks it: 'true',
-- 'false', or the error it raised.
create or replace function pg_temp.st_join(p_user uuid, p_topic text) returns text language plpgsql as $$
declare v boolean;
begin
  perform pg_temp.st_as(p_user);
  v := private.sync_can_join(p_topic);
  reset role;
  return coalesce(v::text, 'null');
exception when others then
  reset role;
  return 'error: ' || sqlerrm;
end $$;

-- How many messages of a topic a user reads, as the Realtime join check
-- reads them: the topic the join names set in the session, the row
-- policies applied. By default the join names the topic read.
create or replace function pg_temp.st_read(p_user uuid, p_topic text, p_named text default '-') returns integer language plpgsql as $$
declare v integer;
begin
  perform pg_temp.st_as(p_user);
  perform set_config('realtime.topic', coalesce(case when p_named = '-' then p_topic else p_named end, ''), true);
  select count(*) into v from realtime.messages where topic = p_topic;
  perform set_config('realtime.topic', '', true);
  reset role;
  return v;
exception when others then
  perform set_config('realtime.topic', '', true);
  reset role;
  return -1;
end $$;

-- Moves the whole change state of a space this far into the past, as if
-- that much time had gone by since every mark and signal it holds.
create or replace function pg_temp.st_shift(p_space text, p_by interval) returns void language plpgsql as $$
declare v_sets text;
begin
  select string_agg(format('%I = %I - %L::interval', column_name, column_name, p_by), ', ')
    into v_sets
    from information_schema.columns
   where table_schema = 'private' and table_name = 'space_sync_state'
     and data_type = 'timestamp with time zone';
  execute format('update private.space_sync_state set %s where space_id = %L', v_sets, p_space);
end $$;

-- Moves every mark and every signal of a space two seconds into the past:
-- outside the one-second gate and outside a one-second window.
create or replace function pg_temp.st_age_signals(p_space text) returns void language sql as $$
  select pg_temp.st_shift(p_space, '2 seconds')
$$;

-- Present browsers: n people beating twice in the current minute each,
-- which sync_active counts as n.
create or replace function pg_temp.st_present(p_space text, n integer) returns void language sql as $$
  insert into private.sync_presence (space_id, bucket, user_id, beats)
  select p_space, date_trunc('minute', clock_timestamp()), gen_random_uuid(), 2
  from generate_series(1, n)
$$;

do $signals$
declare
  v_c text := pg_temp.st_id('c');
  v_d text := pg_temp.st_id('d');
  u_m uuid := pg_temp.st_id('member')::uuid;
  u_x uuid := pg_temp.st_id('stranger')::uuid;
  u_2 uuid := pg_temp.st_id('second')::uuid;
  v_topic text;
  refused text;
  before private.space_sync_state;
  after private.space_sync_state;
  msg record;
  n1 text; n2 text; d text;
  cnt integer;
  w integer;
begin
  v_topic := 'space:' || v_c || ':0';

  -- W1 the budgets and the floor
  begin
    perform pg_temp.st_check('W1 the config holds the five defaults',
      (select jsonb_object_agg(key, value) from private.sync_config)
        = '{"space_budget_msg_s": 400, "global_budget_msg_s": 2000, "window_min_ms": 1000, "window_max_ms": 30000, "doc_payload_max_bytes": 204800}'::jsonb,
      (select jsonb_object_agg(key, value)::text from private.sync_config));
    perform pg_temp.st_check('W1 a space nobody is present in gets the floor',
      private.sync_window_ms(v_c) = 1000, format('window=%s', private.sync_window_ms(v_c)));
    perform pg_temp.st_check('W1 so does a space that is not there',
      private.sync_window_ms('not-an-id') = 1000, format('window=%s', private.sync_window_ms('not-an-id')));
  exception when others then
    perform pg_temp.st_check('W1 the budgets and the floor', false, sqlerrm);
  end;

  -- W2 the window grows with presence against the budgets
  begin
    perform pg_temp.st_present(v_c, 20);
    w := private.sync_window_ms(v_c);
    perform pg_temp.st_check('W2 20 present: 1 s', w = 1000, format('window=%s', w));
    delete from private.sync_presence where space_id = v_c;
    perform pg_temp.st_present(v_c, 1000);
    w := private.sync_window_ms(v_c);
    perform pg_temp.st_check('W2 1 000 present: 5 s', w = 5000, format('window=%s', w));
    delete from private.sync_presence where space_id = v_c;
    perform pg_temp.st_present(v_c, 5000);
    w := private.sync_window_ms(v_c);
    perform pg_temp.st_check('W2 5 000 present: 25 s', w = 25000, format('window=%s', w));
    delete from private.sync_presence where space_id = v_c;
    perform pg_temp.st_present(v_c, 7000);
    w := private.sync_window_ms(v_c);
    perform pg_temp.st_check('W2 7 000 present: the ceiling, 30 s', w = 30000, format('window=%s', w));
    delete from private.sync_presence where space_id = v_c;
    perform pg_temp.st_present(v_c, 20);
    perform pg_temp.st_present(v_d, 5000);
    w := private.sync_window_ms(v_c);
    perform pg_temp.st_check('W2 a busy deployment widens a quiet space''s window',
      w >= 5020 and w < 25000, format('window=%s', w));
    delete from private.sync_presence where space_id in (v_c, v_d);
    perform pg_temp.st_check('W2 and it falls back once the others leave',
      private.sync_window_ms(v_c) = 1000, format('window=%s', private.sync_window_ms(v_c)));
  exception when others then
    perform pg_temp.st_check('W2 the window grows with presence', false, sqlerrm);
  end;

  -- E1 the one emit point
  begin
    perform private.sync_emit('space:x:0', 'changed', '{}'::jsonb);
    select count(*) into cnt from realtime.messages
     where topic = 'space:x:0' and event = 'changed' and private is true and extension = 'broadcast';
    perform pg_temp.st_check('E1 sync_emit inserts one private broadcast', cnt = 1, format('rows=%s', cnt));
  exception when others then
    perform pg_temp.st_check('E1 the one emit point', false, sqlerrm);
  end;

  -- M1 a change signals at once, then the window is silent
  begin
    perform pg_temp.st_check('M1 the space has no state yet', (pg_temp.st_state(v_c)).space_id is null);
    insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
    values (v_c, 'text', 'ST C one', 'space', u_m, u_m) returning id into n1;
    after := pg_temp.st_state(v_c);
    perform pg_temp.st_check('M1 the first change of a space signals once',
      pg_temp.st_signals(v_topic) = 1 and pg_temp.st_signals(v_topic, 'graph') = 1,
      format('signals=%s', pg_temp.st_signals(v_topic)));
    select payload into msg from realtime.messages where realtime.messages.topic = v_topic and event = 'changed' limit 1;
    perform pg_temp.st_check('M1 the signal says the kind and the window, nothing else of the change',
      (msg.payload - 'id') = jsonb_build_object('kind', 'graph', 'window_ms', 1000),
      format('%s', msg.payload));
    perform pg_temp.st_check('M1 the signal is stamped',
      after.graph_signaled_at is not null and after.graph_signaled_at = after.graph_changed_at,
      format('%s', after));
    insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
    values (v_c, 'text', 'ST C two', 'space', u_m, u_m) returning id into n2;
    perform pg_temp.st_check('M1 a second change inside the second signals nothing more',
      pg_temp.st_signals(v_topic) = 1, format('signals=%s', pg_temp.st_signals(v_topic)));
    perform pg_temp.st_age_signals(v_c);
    insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
    values (v_c, 'text', 'ST C three', 'space', u_m, u_m);
    perform pg_temp.st_check('M1 a change after the window signals again',
      pg_temp.st_signals(v_topic, 'graph') = 2, format('signals=%s', pg_temp.st_signals(v_topic)));
    -- signaled just now: the kind stays silent for the window from here
    update private.space_sync_state
       set graph_changed_at = graph_changed_at - interval '2 seconds',
           graph_signaled_at = clock_timestamp(),
           graph_silent_until = clock_timestamp() + interval '1 second'
     where space_id = v_c;
    before := pg_temp.st_state(v_c);
    insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
    values (v_c, 'text', 'ST C four', 'space', u_m, u_m);
    after := pg_temp.st_state(v_c);
    perform pg_temp.st_check('M1 a change inside the window marks',
      after.graph_changed_at > before.graph_changed_at,
      format('before=%s after=%s', before.graph_changed_at, after.graph_changed_at));
    perform pg_temp.st_check('M1 but does not signal',
      pg_temp.st_signals(v_topic) = 2 and after.graph_signaled_at = before.graph_signaled_at,
      format('signals=%s', pg_temp.st_signals(v_topic)));
    -- a member's own write: the trigger, the mark and the emit run as their
    -- definer, so a write through the API signals like any other
    perform pg_temp.st_age_signals(v_c);
    refused := pg_temp.st_refusal(u_m, format(
      'insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id) values (%L, ''text'', ''ST C five'', ''space'', %L, %L)',
      v_c, u_m, u_m));
    perform pg_temp.st_check('M1 a member''s own write goes through', refused is null, refused);
    perform pg_temp.st_check('M1 and signals',
      pg_temp.st_signals(v_topic, 'graph') = 3, format('signals=%s', pg_temp.st_signals(v_topic)));
  exception when others then
    perform pg_temp.st_check('M1 a change signals at once, then the window is silent', false, sqlerrm);
  end;

  -- M2 a deletion and a document signal their own kinds
  begin
    perform pg_temp.st_age_signals(v_c);
    cnt := pg_temp.st_signals(v_topic, 'graph');
    delete from public.knowledge_resources where id = n2;
    after := pg_temp.st_state(v_c);
    perform pg_temp.st_check('M2 a deletion signals graph-delete',
      pg_temp.st_signals(v_topic, 'graph-delete') = 1, format('signals=%s', pg_temp.st_signals(v_topic, 'graph-delete')));
    perform pg_temp.st_check('M2 and only that: the sweep it asks for pulls too',
      pg_temp.st_signals(v_topic, 'graph') = cnt, format('graph=%s was %s', pg_temp.st_signals(v_topic, 'graph'), cnt));
    perform pg_temp.st_check('M2 a deletion marks the graph and the deletion, and stamps both signals',
      after.graph_deleted_at is not null and after.graph_delete_signaled_at = after.graph_deleted_at
        and after.graph_signaled_at = after.graph_delete_signaled_at,
      format('%s', after));
    perform pg_temp.st_age_signals(v_c);
    insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
    values (v_c, 'text', 'ST C doc', 'space', u_m, u_m) returning id into n2;
    d := public.entity_id_generate('doc');
    update public.knowledge_resources set body_ref = jsonb_build_object('doc_id', d) where id = n2;
    insert into public.crdt_documents (id, space_id, created_by, resource_id) values (d, v_c, u_m, n2);
    after := pg_temp.st_state(v_c);
    perform pg_temp.st_check('M2 a document signals documents',
      pg_temp.st_signals(v_topic, 'documents') = 1 and after.documents_signaled_at is not null,
      format('signals=%s state=%s', pg_temp.st_signals(v_topic, 'documents'), after));
    select payload into msg from realtime.messages
     where realtime.messages.topic = v_topic and event = 'changed' and payload->>'kind' = 'documents' limit 1;
    perform pg_temp.st_check('M2 with the window',
      (msg.payload - 'id') = jsonb_build_object('kind', 'documents', 'window_ms', 1000), format('%s', msg.payload));
  exception when others then
    perform pg_temp.st_check('M2 a deletion and a document signal their own kinds', false, sqlerrm);
  end;

  -- M3 a signal that cannot be sent never fails the write
  begin
    create or replace function private.sync_emit(p_topic text, p_event text, p_payload jsonb)
    returns void language plpgsql set search_path = '' as $f$
    begin
      raise exception 'the signal path is down';
    end;
    $f$;
    perform pg_temp.st_age_signals(v_c);
    before := pg_temp.st_state(v_c);
    cnt := pg_temp.st_signals(v_topic);
    begin
      insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
      values (v_c, 'text', 'ST C unsignaled', 'space', u_m, u_m) returning id into n1;
      after := pg_temp.st_state(v_c);
      perform pg_temp.st_check('M3 the write succeeds when the signal fails', true);
      perform pg_temp.st_check('M3 and the change is marked for the probe',
        after.graph_changed_at > before.graph_changed_at, format('before=%s after=%s', before, after));
      perform pg_temp.st_check('M3 nothing was sent', pg_temp.st_signals(v_topic) = cnt);
    exception when others then
      perform pg_temp.st_check('M3 the write succeeds when the signal fails', false, sqlerrm);
    end;
    -- undo the stand-in emit, keep the verdicts above
    raise exception 'st_undo';
  exception when others then
    if sqlerrm <> 'st_undo' then
      perform pg_temp.st_check('M3 a signal that cannot be sent never fails the write', false, sqlerrm);
    end if;
  end;
  perform pg_temp.st_check('M3 the real emit is back',
    (select prosrc from pg_proc where oid = 'private.sync_emit(text, text, jsonb)'::regprocedure) like '%realtime.send%');

  -- J1 who may join a space topic
  begin
    perform pg_temp.st_check('J1 a member may join the current topic',
      pg_temp.st_join(u_m, v_topic) = 'true', pg_temp.st_join(u_m, v_topic));
    perform pg_temp.st_check('J1 a stranger may not',
      pg_temp.st_join(u_x, v_topic) = 'false', pg_temp.st_join(u_x, v_topic));
    perform pg_temp.st_check('J1 nor a member with another epoch',
      pg_temp.st_join(u_m, 'space:' || v_c || ':1') = 'false', pg_temp.st_join(u_m, 'space:' || v_c || ':1'));
    update private.space_sync_state set epoch = 3 where space_id = v_c;
    perform pg_temp.st_check('J1 the epoch is the space''s current one',
      pg_temp.st_join(u_m, 'space:' || v_c || ':3') = 'true' and pg_temp.st_join(u_m, v_topic) = 'false',
      pg_temp.st_join(u_m, 'space:' || v_c || ':3') || ' / ' || pg_temp.st_join(u_m, v_topic));
    update private.space_sync_state set epoch = 0 where space_id = v_c;
    perform pg_temp.st_check('J1 a space with no state yet is at epoch 0',
      (pg_temp.st_state(v_d)).space_id is null
        and pg_temp.st_join(u_m, 'space:' || v_d || ':0') = 'true'
        and pg_temp.st_join(u_m, 'space:' || v_d || ':1') = 'false',
      pg_temp.st_join(u_m, 'space:' || v_d || ':0'));
    perform pg_temp.st_check('J1 malformed topics are refused, never an error',
      pg_temp.st_join(u_m, 'space:not-an-id:0') = 'false'
        and pg_temp.st_join(u_m, 'doc:' || public.entity_id_generate('doc') || ':0.0') = 'false'
        and pg_temp.st_join(u_m, 'garbage') = 'false'
        and pg_temp.st_join(u_m, null) = 'false'
        and pg_temp.st_join(u_m, '') = 'false'
        and pg_temp.st_join(u_m, 'space:' || v_c) = 'false'
        and pg_temp.st_join(u_m, 'space:' || v_c || ':0:0') = 'false'
        and pg_temp.st_join(u_m, 'space:' || v_c || ':-1') = 'false'
        and pg_temp.st_join(u_m, 'space:' || v_c || ':') = 'false'
        and pg_temp.st_join(u_m, 'space:' || v_c || ':99999999999') = 'false'
        and pg_temp.st_join(u_m, 'space::0') = 'false'
        and pg_temp.st_join(u_m, 'space:' || public.entity_id_generate('usr') || ':0') = 'false',
      concat_ws(' ', pg_temp.st_join(u_m, 'space:not-an-id:0'), pg_temp.st_join(u_m, 'garbage'),
        pg_temp.st_join(u_m, null), pg_temp.st_join(u_m, 'space:' || v_c || ':99999999999')));
    perform pg_temp.st_check('J1 the second member may join',
      pg_temp.st_join(u_2, v_topic) = 'true', pg_temp.st_join(u_2, v_topic));
    update public.space_memberships set status = 'suspended' where space_id = v_c and user_id = u_2;
    perform pg_temp.st_check('J1 a suspended member may not join again',
      pg_temp.st_join(u_2, v_topic) = 'false', pg_temp.st_join(u_2, v_topic));
    update public.space_memberships set status = 'active' where space_id = v_c and user_id = u_2;
    delete from public.space_memberships where space_id = v_c and user_id = u_2;
    perform pg_temp.st_check('J1 nor a removed one',
      pg_temp.st_join(u_2, v_topic) = 'false', pg_temp.st_join(u_2, v_topic));
  exception when others then
    perform pg_temp.st_check('J1 who may join a space topic', false, sqlerrm);
  end;

  -- J2 the row policy: members read their topic, nobody signed in publishes
  begin
    cnt := pg_temp.st_signals(v_topic);
    perform pg_temp.st_check('J2 a member reads the signals of their space''s topic',
      cnt > 0 and pg_temp.st_read(u_m, v_topic) = (select count(*)::integer from realtime.messages where realtime.messages.topic = v_topic),
      format('read=%s signals=%s', pg_temp.st_read(u_m, v_topic), cnt));
    perform pg_temp.st_check('J2 a stranger reads none of them',
      pg_temp.st_read(u_x, v_topic) = 0, format('read=%s', pg_temp.st_read(u_x, v_topic)));
    perform pg_temp.st_check('J2 nor does a member whose join names no topic',
      pg_temp.st_read(u_m, v_topic, null) = 0, format('read=%s', pg_temp.st_read(u_m, v_topic, null)));
    perform pg_temp.st_check('J2 nor one whose join names another epoch',
      pg_temp.st_read(u_m, v_topic, 'space:' || v_c || ':1') = 0, format('read=%s', pg_temp.st_read(u_m, v_topic, 'space:' || v_c || ':1')));
    perform set_config('realtime.topic', v_topic, true);
    refused := pg_temp.st_refusal(u_m, format(
      $q$insert into realtime.messages (topic, extension, event, payload, private) values (%L, 'broadcast', 'changed', '{"kind":"graph","window_ms":1000}', true)$q$,
      v_topic));
    perform set_config('realtime.topic', '', true);
    perform pg_temp.st_check('J2 a member cannot publish on their own topic', refused is not null, refused);
    select count(*) into cnt from pg_policies
     where schemaname = 'realtime' and tablename = 'messages'
       and policyname = 'sync subscribers read their topics'
       and cmd = 'SELECT' and roles = '{authenticated}'
       and qual like '%extension = ''broadcast''%' and qual like '%sync_can_join%realtime.topic()%';
    perform pg_temp.st_check('J2 the read policy is the one expected', cnt = 1,
      (select string_agg(policyname || ' ' || cmd || ' ' || qual, '; ') from pg_policies where schemaname = 'realtime' and tablename = 'messages'));
    perform pg_temp.st_check('J2 and no policy lets anyone write',
      not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and cmd <> 'SELECT'));
  exception when others then
    perform pg_temp.st_check('J2 the row policy', false, sqlerrm);
  end;

  -- P1 row changes are no longer published
  perform pg_temp.st_check('P1 the realtime publication carries none of the replicated tables',
    not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public'
                   and tablename in ('crdt_documents', 'knowledge_resources', 'knowledge_edges')),
    (select string_agg(tablename, ',') from pg_publication_tables where pubname = 'supabase_realtime'));

  -- R1 presence is per person, and a loop counts no more than a few browsers
  begin
    perform pg_temp.st_as(u_m);
    for i in 1..20 loop
      perform public.sync_presence_beat(v_c);
    end loop;
    reset role;
    perform pg_temp.st_check('R1 twenty beats in a minute count four',
      (select beats from private.sync_presence where space_id = v_c and user_id = u_m and bucket = date_trunc('minute', clock_timestamp())) = 4
        and private.sync_active(v_c) = 2,
      format('active=%s', private.sync_active(v_c)));
    insert into public.space_memberships (space_id, user_id, status) values (v_c, u_2, 'active');
    perform pg_temp.st_as(u_2);
    perform public.sync_presence_beat(v_c);
    perform public.sync_presence_beat(v_c);
    reset role;
    perform pg_temp.st_check('R1 two people add up',
      (select count(*) from private.sync_presence where space_id = v_c) = 2 and private.sync_active(v_c) = 3,
      format('active=%s', private.sync_active(v_c)));
    insert into private.sync_presence (space_id, bucket, user_id, beats)
    values (v_c, date_trunc('minute', clock_timestamp()) - interval '1 minute', u_m, 2);
    perform pg_temp.st_check('R1 the previous minute still averages in',
      private.sync_active(v_c) = 4 and private.sync_active_all() >= 4,
      format('active=%s all=%s', private.sync_active(v_c), private.sync_active_all()));
  exception when others then
    reset role;
    perform pg_temp.st_check('R1 presence is per person', false, sqlerrm);
  end;

  -- G1 grants
  perform pg_temp.st_check('G1 a signed-in caller may ask whether they may join',
    has_function_privilege('authenticated', 'private.sync_can_join(text)', 'execute')
      and not has_function_privilege('anon', 'private.sync_can_join(text)', 'execute'));
  perform pg_temp.st_check('G1 the join check only reads',
    (select provolatile = 's' and prosecdef from pg_proc where oid = 'private.sync_can_join(text)'::regprocedure));
  perform pg_temp.st_check('G1 nobody signed in emits, sizes a window or reads the config',
    not has_function_privilege('authenticated', 'private.sync_emit(text, text, jsonb)', 'execute')
      and not has_function_privilege('anon', 'private.sync_emit(text, text, jsonb)', 'execute')
      and not has_function_privilege('authenticated', 'private.sync_window_ms(text)', 'execute')
      and not has_function_privilege('authenticated', 'private.sync_active_all()', 'execute')
      and not has_table_privilege('authenticated', 'private.sync_config', 'select'));
end
$signals$;

-- B1 the first change after a window signals, even inside the second of
-- the mark it follows. With a 25-second window: a change at 0 signals; one
-- at 24.5 is inside the window and does not; one at 25.2 is the first of
-- the next window and must, though the mark it would move is 0.7 s old.
do $edge$
declare
  v_org text := pg_temp.st_id('org');
  u_m uuid := pg_temp.st_id('member')::uuid;
  v_e text; v_f text; v_g text;
  t_e text; t_f text; t_g text;
  n text; d text; r1 text; r2 text; r3 text;
  msg record;
begin
  update private.sync_config set value = 25000 where key in ('window_min_ms', 'window_max_ms');
  insert into public.spaces (organization_id, name, slug) values (v_org, 'ST E', 'st-e-' || substr(md5(random()::text),1,8)) returning id into v_e;
  insert into public.spaces (organization_id, name, slug) values (v_org, 'ST F', 'st-f-' || substr(md5(random()::text),1,8)) returning id into v_f;
  insert into public.spaces (organization_id, name, slug) values (v_org, 'ST G', 'st-g-' || substr(md5(random()::text),1,8)) returning id into v_g;
  t_e := 'space:' || v_e || ':0';
  t_f := 'space:' || v_f || ':0';
  t_g := 'space:' || v_g || ':0';

  -- the graph
  insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
  values (v_e, 'text', 'ST E one', 'space', u_m, u_m);
  select payload into msg from realtime.messages where topic = t_e and event = 'changed' limit 1;
  perform pg_temp.st_check('B1 graph: the first change signals, with the 25-second window',
    pg_temp.st_signals(t_e, 'graph') = 1 and (msg.payload->>'window_ms')::int = 25000, format('%s', msg.payload));
  perform pg_temp.st_shift(v_e, '24.5 seconds');
  insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
  values (v_e, 'text', 'ST E two', 'space', u_m, u_m);
  perform pg_temp.st_check('B1 graph: a change inside the window does not',
    pg_temp.st_signals(t_e, 'graph') = 1, format('signals=%s', pg_temp.st_signals(t_e, 'graph')));
  perform pg_temp.st_shift(v_e, '0.7 seconds');
  insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
  values (v_e, 'text', 'ST E three', 'space', u_m, u_m);
  perform pg_temp.st_check('B1 graph: the first change after the window does, inside the second of the last mark',
    pg_temp.st_signals(t_e, 'graph') = 2, format('signals=%s', pg_temp.st_signals(t_e, 'graph')));

  -- the documents
  insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
  values (v_f, 'text', 'ST F doc', 'space', u_m, u_m) returning id into n;
  d := public.entity_id_generate('doc');
  update public.knowledge_resources set body_ref = jsonb_build_object('doc_id', d) where id = n;
  insert into public.crdt_documents (id, space_id, created_by, resource_id) values (d, v_f, u_m, n);
  perform pg_temp.st_check('B1 documents: the first change signals',
    pg_temp.st_signals(t_f, 'documents') = 1, format('signals=%s', pg_temp.st_signals(t_f, 'documents')));
  perform pg_temp.st_shift(v_f, '24.5 seconds');
  insert into public.crdt_updates (doc_id, bytes, writer, created_by)
  values (d, '\x01'::bytea, public.entity_id_generate('wrt'), u_m);
  perform pg_temp.st_check('B1 documents: a change inside the window does not',
    pg_temp.st_signals(t_f, 'documents') = 1, format('signals=%s', pg_temp.st_signals(t_f, 'documents')));
  perform pg_temp.st_shift(v_f, '0.7 seconds');
  insert into public.crdt_updates (doc_id, bytes, writer, created_by)
  values (d, '\x02'::bytea, public.entity_id_generate('wrt'), u_m);
  perform pg_temp.st_check('B1 documents: the first change after the window does, inside the second of the last mark',
    pg_temp.st_signals(t_f, 'documents') = 2, format('signals=%s', pg_temp.st_signals(t_f, 'documents')));

  -- a deletion
  insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
  values (v_g, 'text', 'ST G one', 'space', u_m, u_m) returning id into r1;
  insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
  values (v_g, 'text', 'ST G two', 'space', u_m, u_m) returning id into r2;
  insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
  values (v_g, 'text', 'ST G three', 'space', u_m, u_m) returning id into r3;
  delete from public.knowledge_resources where id = r1;
  perform pg_temp.st_check('B1 graph-delete: the first deletion signals',
    pg_temp.st_signals(t_g, 'graph-delete') = 1, format('signals=%s', pg_temp.st_signals(t_g, 'graph-delete')));
  perform pg_temp.st_shift(v_g, '24.5 seconds');
  delete from public.knowledge_resources where id = r2;
  perform pg_temp.st_check('B1 graph-delete: a deletion inside the window does not',
    pg_temp.st_signals(t_g, 'graph-delete') = 1, format('signals=%s', pg_temp.st_signals(t_g, 'graph-delete')));
  perform pg_temp.st_shift(v_g, '0.7 seconds');
  delete from public.knowledge_resources where id = r3;
  perform pg_temp.st_check('B1 graph-delete: the first deletion after the window does, inside the second of the last mark',
    pg_temp.st_signals(t_g, 'graph-delete') = 2, format('signals=%s', pg_temp.st_signals(t_g, 'graph-delete')));
  perform pg_temp.st_check('B1 graph-delete: and still as the one signal of a deletion',
    pg_temp.st_signals(t_g, 'graph') = 1, format('graph=%s', pg_temp.st_signals(t_g, 'graph')));

  -- undo the config and the spaces; the verdicts above stay
  raise exception 'st_undo';
exception when others then
  if sqlerrm <> 'st_undo' then
    perform pg_temp.st_check('B1 the first change after a window signals', false, sqlerrm);
  end if;
end
$edge$;

do $after$
begin
  perform pg_temp.st_check('B1 the 25-second window was the test''s alone',
    (select value from private.sync_config where key = 'window_max_ms') = 30000);
end
$after$;

-- C1 the silence a signal states is the silence the server keeps: a change
-- in presence takes effect from the next signal, never inside a silence
-- already stated, so the browsers' follow-up, timed by the window they were
-- told, always covers it.
do $contract$
declare
  v_org text := pg_temp.st_id('org');
  u_m uuid := pg_temp.st_id('member')::uuid;
  v_h text; v_i text; t_h text; t_i text;
  w integer;
begin
  insert into public.spaces (organization_id, name, slug) values (v_org, 'ST H', 'st-h-' || substr(md5(random()::text),1,8)) returning id into v_h;
  insert into public.spaces (organization_id, name, slug) values (v_org, 'ST I', 'st-i-' || substr(md5(random()::text),1,8)) returning id into v_i;
  t_h := 'space:' || v_h || ':0';
  t_i := 'space:' || v_i || ':0';

  -- shrink: a signal states 25 s, then the space empties
  perform pg_temp.st_present(v_h, 5000);
  insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
  values (v_h, 'text', 'ST H one', 'space', u_m, u_m);
  perform pg_temp.st_check('C1 shrink: a busy space signals a 25-second window',
    pg_temp.st_signals(t_h) = 1
      and (select (payload->>'window_ms')::int from realtime.messages where topic = t_h and event = 'changed' limit 1) = 25000);
  delete from private.sync_presence where space_id = v_h;
  w := private.sync_window_ms(v_h);
  perform pg_temp.st_shift(v_h, '2 seconds');
  insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
  values (v_h, 'text', 'ST H two', 'space', u_m, u_m);
  perform pg_temp.st_check('C1 shrink: the window is 1 s now, and a change at 2 s is still inside the stated silence',
    w = 1000 and pg_temp.st_signals(t_h) = 1, format('window=%s signals=%s', w, pg_temp.st_signals(t_h)));
  perform pg_temp.st_shift(v_h, '23.2 seconds');
  insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
  values (v_h, 'text', 'ST H three', 'space', u_m, u_m);
  perform pg_temp.st_check('C1 shrink: the change at 25.2 s signals, with the 1-second window',
    pg_temp.st_signals(t_h) = 2
      and exists (select 1 from realtime.messages where topic = t_h and event = 'changed' and (payload->>'window_ms')::int = 1000),
    format('signals=%s', pg_temp.st_signals(t_h)));

  -- grow: a signal states 1 s, then the space fills
  insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
  values (v_i, 'text', 'ST I one', 'space', u_m, u_m);
  perform pg_temp.st_check('C1 grow: a quiet space signals a 1-second window',
    pg_temp.st_signals(t_i) = 1
      and (select (payload->>'window_ms')::int from realtime.messages where topic = t_i and event = 'changed' limit 1) = 1000);
  perform pg_temp.st_present(v_i, 5000);
  perform pg_temp.st_shift(v_i, '2 seconds');
  insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
  values (v_i, 'text', 'ST I two', 'space', u_m, u_m);
  perform pg_temp.st_check('C1 grow: the change at 2 s is past the stated silence and signals, with the 25-second window',
    pg_temp.st_signals(t_i) = 2
      and exists (select 1 from realtime.messages where topic = t_i and event = 'changed' and (payload->>'window_ms')::int = 25000),
    format('signals=%s', pg_temp.st_signals(t_i)));
  perform pg_temp.st_shift(v_i, '2 seconds');
  insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
  values (v_i, 'text', 'ST I three', 'space', u_m, u_m);
  perform pg_temp.st_check('C1 grow: a change at 4 s is inside the 25 seconds just stated',
    pg_temp.st_signals(t_i) = 2, format('signals=%s', pg_temp.st_signals(t_i)));

  raise exception 'st_undo';
exception when others then
  if sqlerrm <> 'st_undo' then
    perform pg_temp.st_check('C1 the silence a signal states is the one kept', false, sqlerrm);
  end if;
end
$contract$;

rollback;
