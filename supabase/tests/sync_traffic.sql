-- Probe for the change state, the change probe and presence.
--
-- WHAT THIS IS FOR
--   A device asks the space "did anything of this kind change since my last
--   look" once per heartbeat instead of polling every replicated table. The
--   answer is kept by row triggers on those tables (one write per second per
--   space and kind at most) and read by public.sync_probe; browsers that are
--   present beat public.sync_presence_beat once a minute. This script pins
--   what those promise: who may ask, what a write leaves behind, the
--   one-second gate, a space teardown that still holds rows, and the
--   presence count with its lazy cleanup.
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
--   one organization with two spaces; a member of both and a stranger to
--   both. The first space starts with no replicated rows at all, so its
--   change state does not exist until the first write.

begin;

-- The mark triggers are deferred to commit in production, so a long
-- transaction marks at the moment it lands. Here the whole script is one
-- transaction that is rolled back, so they are made to fire at the end of
-- each statement instead: that is what makes a mark observable at all.
set constraints all immediate;

create temporary table st_ids (k text primary key, v text);

do $fixture$
declare
  v_org text; v_a text; v_b text;
  u_m uuid := gen_random_uuid();
  u_x uuid := gen_random_uuid();
  r_member text;
begin
  insert into public.organizations (name, slug) values ('ST Org', 'st-org-' || substr(md5(random()::text),1,8)) returning id into v_org;
  insert into public.spaces (organization_id, name, slug) values (v_org, 'ST A', 'st-a-' || substr(md5(random()::text),1,8)) returning id into v_a;
  insert into public.spaces (organization_id, name, slug) values (v_org, 'ST B', 'st-b-' || substr(md5(random()::text),1,8)) returning id into v_b;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  select x, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'st-'||x||'@st.invalid', '', now(), now(), now()
  from unnest(array[u_m, u_x]) as x;
  insert into public.profiles (user_id, email, display_name)
  select x, 'st-'||x||'@st.invalid', 'ST' from unnest(array[u_m, u_x]) as x
  on conflict (user_id) do nothing;

  -- u_x is a member of neither space.
  insert into public.space_memberships (space_id, user_id, status) values
    (v_a, u_m, 'active'), (v_b, u_m, 'active');
  select id into r_member from public.roles where key='member' and role_kind='system' and owner_organization_id is null and archived_at is null limit 1;
  insert into public.user_role (user_id, role_id, space_id, organization_id) values
    (u_m, r_member, v_a, null), (u_m, r_member, v_b, null);

  insert into st_ids values ('org', v_org), ('a', v_a), ('b', v_b),
    ('member', u_m::text), ('stranger', u_x::text);
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
  insert into private.sync_presence (space_id, bucket, beats)
  values (v_a, date_trunc('minute', clock_timestamp()) - interval '1 minute', 4);
  perform pg_temp.st_check('S9 the previous minute counts too',
    private.sync_active(v_a) = 3, format('active=%s', private.sync_active(v_a)));
  -- the first beat of a new minute cleans up: the current minute is taken
  -- away so the next beat is the first of its minute again.
  insert into private.sync_presence (space_id, bucket, beats)
  values (v_a, date_trunc('minute', clock_timestamp()) - interval '11 minutes', 7);
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

rollback;
