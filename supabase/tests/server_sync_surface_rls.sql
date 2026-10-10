-- Adversarial RLS/RPC probe over the server sync surface: crdt documents and
-- their append-only update log, the server search index, and workbench blobs.
--
-- WHAT THIS IS FOR
--   Row level security is invisible when it works and invisible when it does
--   not: a broken policy leaks rows silently and a missing one denies nothing.
--   This script asserts the fence from the OUTSIDE, as three real users with
--   real memberships, so every claim the migration headers make is checked
--   against the database rather than trusted.
--
-- HOW TO RUN (against a stand, never production)
--   docker exec -i <db-container> psql -U postgres -d postgres \
--     -f supabase/tests/server_sync_surface_rls.sql
--   Expect every line to read PASS. Any *** FAIL *** is a real regression.
--
-- SAFETY
--   Everything runs inside ONE transaction that ends in ROLLBACK, and the
--   destructive probes (TRUNCATE, storage writes) are additionally wrapped in
--   plpgsql BEGIN..EXCEPTION subtransactions that undo themselves even when the
--   attack SUCCEEDS — so a genuine finding is reported without wrecking the
--   fixture the later assertions depend on.
--
-- FIXTURE
--   alice   -> space A, role author  (read/create/update, no delete)
--   adam    -> space A, role admin   (all verbs)
--   mallory -> space B, role admin in B only — full rights in the WRONG space,
--              which is what makes her the interesting attacker: every denial
--              she hits is about SCOPE, not about lacking permissions.

\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------------------
-- fixture: one org, two spaces, three users.
-- ---------------------------------------------------------------------------
create temporary table t14_ids (k text primary key, v text);

do $fixture$
declare
  v_org text; v_a text; v_b text;
  u_alice uuid := gen_random_uuid();
  u_adam  uuid := gen_random_uuid();
  u_mal   uuid := gen_random_uuid();
  -- bob: an ordinary member of space A who owns nothing there. the body fence
  -- is about him: membership alone must open no private body.
  u_bob   uuid := gen_random_uuid();
  r_admin text; r_author text; r_member text;
  v_doc_a text; v_doc_b text;
begin
  insert into public.organizations (name, slug) values ('T14 Org', 't14-org-' || substr(md5(random()::text),1,8)) returning id into v_org;
  insert into public.spaces (organization_id, name, slug) values (v_org, 'T14 A', 't14-a-' || substr(md5(random()::text),1,8)) returning id into v_a;
  insert into public.spaces (organization_id, name, slug) values (v_org, 'T14 B', 't14-b-' || substr(md5(random()::text),1,8)) returning id into v_b;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (u_alice, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alice-'||u_alice||'@t14.invalid', '', now(), now(), now()),
         (u_adam,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adam-'||u_adam||'@t14.invalid', '', now(), now(), now()),
         (u_mal,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mal-'||u_mal||'@t14.invalid', '', now(), now(), now()),
         (u_bob,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bob-'||u_bob||'@t14.invalid', '', now(), now(), now());

  insert into public.profiles (user_id, email, display_name)
  values (u_alice, 'alice@t14.invalid', 'Alice'), (u_adam, 'adam@t14.invalid', 'Adam'), (u_mal, 'mallory@t14.invalid', 'Mallory'), (u_bob, 'bob@t14.invalid', 'Bob')
  on conflict (user_id) do nothing;

  insert into public.space_memberships (space_id, user_id, status) values
    (v_a, u_alice, 'active'), (v_a, u_adam, 'active'), (v_b, u_mal, 'active'), (v_a, u_bob, 'active');

  select id into r_admin  from public.roles where key='admin'  and role_kind='system' and owner_organization_id is null and archived_at is null limit 1;
  select id into r_author from public.roles where key='author' and role_kind='system' and owner_organization_id is null and archived_at is null limit 1;
  select id into r_member from public.roles where key='member' and role_kind='system' and owner_organization_id is null and archived_at is null limit 1;

  -- user_role_check: a space-scoped grant carries space_id only (organization_id null).
  insert into public.user_role (user_id, role_id, space_id, organization_id) values
    (u_alice, r_author, v_a, null),
    (u_adam,  r_admin,  v_a, null),
    (u_mal,   r_admin,  v_b, null),
    (u_bob,   r_member, v_a, null);

  -- one document + update log in EACH space, seeded as owner (bypasses RLS on purpose)
  insert into public.crdt_documents (space_id, created_by) values (v_a, u_alice) returning id into v_doc_a;
  insert into public.crdt_documents (space_id, created_by) values (v_b, u_mal)   returning id into v_doc_b;
  insert into public.crdt_updates (doc_id, bytes, writer, created_by) values
    (v_doc_a, '\x01'::bytea, 'inst-alice', u_alice),
    (v_doc_a, '\x02'::bytea, 'inst-alice', u_alice),
    (v_doc_b, '\x03'::bytea, 'inst-mal',   u_mal);

  insert into public.workbench_blobs (space_id, hash, size, mime, created_by) values
    (v_a, repeat('a',64), 10, 'text/plain', u_alice),
    (v_b, repeat('b',64), 10, 'text/plain', u_mal);

  insert into public.server_document_index_state (document_id, space_id, title, indexed_watermark, model_id)
  values (v_doc_a, v_a, 'Alice secret plan', 2, 'test-model'),
         (v_doc_b, v_b, 'Mallory notes',     1, 'test-model');
  insert into public.server_document_chunk (document_id, space_id, ord, char_start, text, embedding, model_id) values
    (v_doc_a, v_a, 0, 0, 'alice confidential merger memo', array_fill(0.1::real, array[384])::extensions.vector(384), 'test-model'),
    (v_doc_b, v_b, 0, 0, 'mallory grocery list',          array_fill(0.1::real, array[384])::extensions.vector(384), 'test-model');

  insert into t14_ids values ('org',v_org),('space_a',v_a),('space_b',v_b),
    ('alice',u_alice::text),('adam',u_adam::text),('mallory',u_mal::text),('bob',u_bob::text),
    ('doc_a',v_doc_a),('doc_b',v_doc_b);
end
$fixture$;

-- ---------------------------------------------------------------------------
-- probe harness
-- ---------------------------------------------------------------------------
create or replace function pg_temp.t14_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'role','authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
end $$;

-- a probe passes when the actual outcome STARTS WITH the expected token, so
-- 'DENIED' matches 'DENIED (42501)' and 'DENIED: <message>' without the test
-- having to hard-code sqlstates or wording.
create or replace function pg_temp.t14_report(p_id text, p_expect text, p_actual text) returns void language plpgsql as $$
begin
  raise notice '% | % | expected=% actual=%',
    case when p_actual like p_expect || '%' then 'PASS' else '*** FAIL ***' end, p_id, p_expect, p_actual;
end $$;

do $probe$
declare
  v_a text; v_b text; u_alice uuid; u_adam uuid; u_mal uuid; d_a text; d_b text;
  n int; b boolean; txt text;
begin
  select v into v_a from t14_ids where k='space_a';
  select v into v_b from t14_ids where k='space_b';
  select v into d_a from t14_ids where k='doc_a';
  select v into d_b from t14_ids where k='doc_b';
  select v::uuid into u_alice from t14_ids where k='alice';
  select v::uuid into u_adam  from t14_ids where k='adam';
  select v::uuid into u_mal   from t14_ids where k='mallory';

  raise notice '=== A. cross-space reads (mallory: admin in B, nothing in A) ===';

  begin perform pg_temp.t14_as(u_mal);
    select count(*) into n from public.crdt_documents where id = d_a;
    perform pg_temp.t14_report('A1 crdt_documents cross-space select', '0', n::text);
  exception when others then perform pg_temp.t14_report('A1 crdt_documents cross-space select','0','ERR '||sqlerrm); end;
  reset role;

  begin perform pg_temp.t14_as(u_mal);
    select count(*) into n from public.crdt_updates where doc_id = d_a;
    perform pg_temp.t14_report('A2 crdt_updates cross-space select', '0', n::text);
  exception when others then perform pg_temp.t14_report('A2 crdt_updates cross-space select','0','ERR '||sqlerrm); end;
  reset role;

  begin perform pg_temp.t14_as(u_mal);
    select count(*) into n from public.crdt_document_versions where doc_id = d_a;
    perform pg_temp.t14_report('A3 crdt_document_versions cross-space select', '0', n::text);
  exception when others then perform pg_temp.t14_report('A3 versions cross-space select','0','ERR '||sqlerrm); end;
  reset role;

  begin perform pg_temp.t14_as(u_mal);
    select count(*) into n from public.server_document_chunk where space_id = v_a;
    perform pg_temp.t14_report('A4 server_document_chunk cross-space select', '0', n::text);
  exception when others then perform pg_temp.t14_report('A4 chunk cross-space select','0','ERR '||sqlerrm); end;
  reset role;

  begin perform pg_temp.t14_as(u_mal);
    select count(*) into n from public.server_document_index_state where space_id = v_a;
    perform pg_temp.t14_report('A5 index_state cross-space select (title leak)', '0', n::text);
  exception when others then perform pg_temp.t14_report('A5 index_state cross-space select','0','ERR '||sqlerrm); end;
  reset role;

  begin perform pg_temp.t14_as(u_mal);
    select count(*) into n from public.workbench_blobs where space_id = v_a;
    perform pg_temp.t14_report('A6 workbench_blobs cross-space select', '0', n::text);
  exception when others then perform pg_temp.t14_report('A6 blobs cross-space select','0','ERR '||sqlerrm); end;
  reset role;

  begin perform pg_temp.t14_as(u_alice);
    select count(*) into n from public.crdt_documents where id = d_a;
    perform pg_temp.t14_report('A7 positive control: alice reads own space doc', '1', n::text);
  exception when others then perform pg_temp.t14_report('A7 positive control','1','ERR '||sqlerrm); end;
  reset role;

  raise notice '=== B. cross-space writes ===';

  begin perform pg_temp.t14_as(u_mal);
    insert into public.crdt_updates (doc_id, bytes, writer, created_by) values (d_a, '\xff'::bytea, 'inst-mal', u_mal);
    perform pg_temp.t14_report('B1 mallory appends update to alice doc', 'DENIED', 'INSERTED');
  exception when others then perform pg_temp.t14_report('B1 mallory appends update to alice doc','DENIED','DENIED ('||sqlstate||')'); end;
  reset role;

  begin perform pg_temp.t14_as(u_mal);
    insert into public.crdt_documents (space_id, created_by) values (v_a, u_mal);
    perform pg_temp.t14_report('B2 mallory creates doc in space A', 'DENIED', 'INSERTED');
  exception when others then perform pg_temp.t14_report('B2 mallory creates doc in space A','DENIED','DENIED ('||sqlstate||')'); end;
  reset role;

  begin perform pg_temp.t14_as(u_alice);
    insert into public.crdt_documents (space_id, created_by) values (v_a, u_mal);
    perform pg_temp.t14_report('B3 alice spoofs created_by=mallory', 'DENIED', 'INSERTED');
  exception when others then perform pg_temp.t14_report('B3 alice spoofs created_by','DENIED','DENIED ('||sqlstate||')'); end;
  reset role;

  begin perform pg_temp.t14_as(u_alice);
    insert into public.crdt_updates (doc_id, bytes, writer, created_by) values (d_a, '\xfe'::bytea, 'inst-x', u_mal);
    perform pg_temp.t14_report('B4 alice spoofs update created_by', 'DENIED', 'INSERTED');
  exception when others then perform pg_temp.t14_report('B4 alice spoofs update created_by','DENIED','DENIED ('||sqlstate||')'); end;
  reset role;

  begin perform pg_temp.t14_as(u_mal);
    insert into public.workbench_blobs (space_id, hash, size, mime, created_by) values (v_a, repeat('c',64), 1, 'text/plain', u_mal);
    perform pg_temp.t14_report('B5 mallory registers blob in space A', 'DENIED', 'INSERTED');
  exception when others then perform pg_temp.t14_report('B5 mallory registers blob in space A','DENIED','DENIED ('||sqlstate||')'); end;
  reset role;

  raise notice '=== C. the deliberately-absent policies (the fence) ===';

  begin perform pg_temp.t14_as(u_alice);
    update public.crdt_documents set snapshot_seq = 999999 where id = d_a;
    get diagnostics n = row_count;
    perform pg_temp.t14_report('C1 direct UPDATE crdt_documents (snapshot_seq corruption)', 'DENIED', case when n = 0 then 'DENIED (0 rows visible/affected)' else 'REACHED '||n::text||' rows' end);
  exception when others then perform pg_temp.t14_report('C1 direct UPDATE crdt_documents','DENIED','DENIED ('||sqlstate||')'); end;
  reset role;

  begin perform pg_temp.t14_as(u_alice);
    delete from public.crdt_updates where doc_id = d_a;
    get diagnostics n = row_count;
    perform pg_temp.t14_report('C2 direct DELETE crdt_updates (log destruction)', 'DENIED', case when n = 0 then 'DENIED (0 rows visible/affected)' else 'REACHED '||n::text||' rows' end);
  exception when others then perform pg_temp.t14_report('C2 direct DELETE crdt_updates','DENIED','DENIED ('||sqlstate||')'); end;
  reset role;

  begin perform pg_temp.t14_as(u_alice);
    update public.crdt_updates set bytes = '\x00'::bytea where doc_id = d_a;
    get diagnostics n = row_count;
    perform pg_temp.t14_report('C3 direct UPDATE crdt_updates (history rewrite)', 'DENIED', case when n = 0 then 'DENIED (0 rows visible/affected)' else 'REACHED '||n::text||' rows' end);
  exception when others then perform pg_temp.t14_report('C3 direct UPDATE crdt_updates','DENIED','DENIED ('||sqlstate||')'); end;
  reset role;

  begin perform pg_temp.t14_as(u_alice);
    delete from public.crdt_documents where id = d_a;
    get diagnostics n = row_count;
    perform pg_temp.t14_report('C4 author (non-admin) deletes document', 'DENIED', case when n = 0 then 'DENIED (0 rows visible/affected)' else 'REACHED '||n::text||' rows' end);
  exception when others then perform pg_temp.t14_report('C4 author deletes document','DENIED','DENIED ('||sqlstate||')'); end;
  reset role;

  begin perform pg_temp.t14_as(u_alice);
    delete from public.workbench_blobs where space_id = v_a;
    get diagnostics n = row_count;
    perform pg_temp.t14_report('C5 client deletes blob metadata row', 'DENIED', case when n = 0 then 'DENIED (0 rows visible/affected)' else 'REACHED '||n::text||' rows' end);
  exception when others then perform pg_temp.t14_report('C5 client deletes blob row','DENIED','DENIED ('||sqlstate||')'); end;
  reset role;

  begin perform pg_temp.t14_as(u_alice);
    update public.workbench_blobs set size = 0 where space_id = v_a;
    get diagnostics n = row_count;
    perform pg_temp.t14_report('C6 client updates blob metadata row', 'DENIED', case when n = 0 then 'DENIED (0 rows visible/affected)' else 'REACHED '||n::text||' rows' end);
  exception when others then perform pg_temp.t14_report('C6 client updates blob row','DENIED','DENIED ('||sqlstate||')'); end;
  reset role;

  begin perform pg_temp.t14_as(u_alice);
    insert into public.server_document_chunk (document_id, space_id, ord, char_start, text, embedding, model_id)
    values (d_a, v_a, 99, 0, 'poisoned', array_fill(0.5::real, array[384])::extensions.vector(384), 'test-model');
    perform pg_temp.t14_report('C7 client injects search chunk (index poisoning)', 'DENIED', 'INSERTED');
  exception when others then perform pg_temp.t14_report('C7 client injects search chunk','DENIED','DENIED ('||sqlstate||')'); end;
  reset role;

  begin perform pg_temp.t14_as(u_alice);
    update public.server_document_index_state set title = 'hijacked' where document_id = d_a;
    get diagnostics n = row_count;
    perform pg_temp.t14_report('C8 client rewrites index bookkeeping', 'DENIED', case when n = 0 then 'DENIED (0 rows visible/affected)' else 'REACHED '||n::text||' rows' end);
  exception when others then perform pg_temp.t14_report('C8 client rewrites index state','DENIED','DENIED ('||sqlstate||')'); end;
  reset role;

  raise notice '=== D. TRUNCATE (bypasses RLS entirely if granted) ===';
  -- plpgsql cannot issue SAVEPOINT, but a BEGIN..EXCEPTION block IS an implicit
  -- subtransaction: raising a sentinel after a SUCCESSFUL truncate rolls that
  -- truncate back, so a real bypass is reported without destroying the fixture
  -- the later probes assert on. (raise notice is not rolled back — it is
  -- delivered immediately — so the verdict still reaches the transcript.)

  begin perform pg_temp.t14_as(u_alice);
    truncate table public.crdt_updates cascade;
    raise exception 'T14_UNDO' using errcode = 'P0001';
  exception
    when others then
      reset role;
      perform pg_temp.t14_report('D1 authenticated TRUNCATE crdt_updates', 'DENIED',
        case when sqlerrm = 'T14_UNDO' then 'TRUNCATED — RLS bypassed' else 'DENIED ('||sqlstate||')' end);
  end;
  reset role;

  begin perform pg_temp.t14_as(u_mal);
    truncate table public.server_document_chunk cascade;
    raise exception 'T14_UNDO' using errcode = 'P0001';
  exception
    when others then
      reset role;
      perform pg_temp.t14_report('D2 authenticated TRUNCATE server_document_chunk', 'DENIED',
        case when sqlerrm = 'T14_UNDO' then 'TRUNCATED — RLS bypassed' else 'DENIED ('||sqlstate||')' end);
  end;
  reset role;

  begin perform pg_temp.t14_as(u_mal);
    truncate table public.workbench_blobs cascade;
    raise exception 'T14_UNDO' using errcode = 'P0001';
  exception
    when others then
      reset role;
      perform pg_temp.t14_report('D3 authenticated TRUNCATE workbench_blobs', 'DENIED',
        case when sqlerrm = 'T14_UNDO' then 'TRUNCATED — RLS bypassed' else 'DENIED ('||sqlstate||')' end);
  end;
  reset role;

  raise notice '=== E. rpc_compact_document ===';

  begin perform pg_temp.t14_as(u_mal);
    select public.rpc_compact_document(d_a, '\xdead'::bytea, 1) into b;
    perform pg_temp.t14_report('E1 mallory compacts alice document', 'DENIED', 'returned '||coalesce(b::text,'null'));
  exception when others then perform pg_temp.t14_report('E1 mallory compacts alice doc','DENIED','DENIED: '||sqlerrm); end;
  reset role;

  begin perform pg_temp.t14_as(u_mal);
    select public.rpc_compact_document('doc_does_not_exist_'||md5(random()::text), '\xdead'::bytea, 1) into b;
    perform pg_temp.t14_report('E2 existence-oracle probe (nonexistent doc)', 'DENIED', 'returned '||coalesce(b::text,'null'));
  exception when others then perform pg_temp.t14_report('E2 existence-oracle probe','DENIED','DENIED: '||sqlerrm); end;
  reset role;

  begin perform pg_temp.t14_as(u_alice);
    select public.rpc_compact_document(d_a, '\xdead'::bytea, 99999) into b;
    perform pg_temp.t14_report('E3 covers_seq beyond tail', 'false', coalesce(b::text,'null'));
  exception when others then perform pg_temp.t14_report('E3 covers_seq beyond tail','false','ERR '||sqlerrm); end;
  reset role;

  begin perform pg_temp.t14_as(u_alice);
    select public.rpc_compact_document(d_a, ''::bytea, 1) into b;
    perform pg_temp.t14_report('E4 empty snapshot rejected', 'DENIED', 'returned '||coalesce(b::text,'null'));
  exception when others then perform pg_temp.t14_report('E4 empty snapshot rejected','DENIED','DENIED: '||sqlerrm); end;
  reset role;

  raise notice '=== F. derive-worker RPCs must be service_role only ===';

  begin perform pg_temp.t14_as(u_alice);
    perform public.rpc_list_documents_to_index('test-model');
    perform pg_temp.t14_report('F1 authenticated calls rpc_list_documents_to_index', 'DENIED', 'EXECUTED');
  exception when others then perform pg_temp.t14_report('F1 authenticated calls rpc_list_documents_to_index','DENIED','DENIED ('||sqlstate||')'); end;
  reset role;

  begin perform pg_temp.t14_as(u_alice);
    perform public.rpc_replace_server_document_chunks(d_a, v_a, 'test-model', 'pwned', 1, '[]'::jsonb);
    perform pg_temp.t14_report('F2 authenticated calls rpc_replace_server_document_chunks', 'DENIED', 'EXECUTED');
  exception when others then perform pg_temp.t14_report('F2 authenticated calls rpc_replace_server_document_chunks','DENIED','DENIED ('||sqlstate||')'); end;
  reset role;

  raise notice '=== G. hybrid search leakage (rpc_search_server_documents, SECURITY INVOKER) ===';

  begin perform pg_temp.t14_as(u_mal);
    select count(*) into n from public.rpc_search_server_documents('merger memo confidential', array_fill(0.1::real, array[384])::extensions.vector(384), 'test-model', 10) r
      where r.document_id = d_a;
    perform pg_temp.t14_report('G1 mallory search returns alice document', '0', n::text);
  exception when others then perform pg_temp.t14_report('G1 mallory search returns alice doc','0','ERR '||sqlerrm); end;
  reset role;

  begin perform pg_temp.t14_as(u_mal);
    select coalesce(string_agg(r.title||'/'||r.excerpt, ' ; '), '(empty)') into txt
      from public.rpc_search_server_documents('merger memo confidential grocery', array_fill(0.1::real, array[384])::extensions.vector(384), 'test-model', 10) r;
    perform pg_temp.t14_report('G2 mallory search payload contains no alice text', 'clean',
      case when txt like '%merger%' or txt like '%Alice secret%' then 'LEAKED: '||txt else 'clean' end);
  exception when others then perform pg_temp.t14_report('G2 search payload leak','clean','ERR '||sqlerrm); end;
  reset role;

  begin perform pg_temp.t14_as(u_alice);
    select count(*) into n from public.rpc_search_server_documents('merger memo confidential', array_fill(0.1::real, array[384])::extensions.vector(384), 'test-model', 10) r
      where r.document_id = d_a;
    perform pg_temp.t14_report('G3 positive control: alice finds her own document', '1', n::text);
  exception when others then perform pg_temp.t14_report('G3 positive control search','1','ERR '||sqlerrm); end;
  reset role;

  raise notice '=== H. anon reach ===';

  begin
    execute 'set local role anon';
    select count(*) into n from public.crdt_documents;
    perform pg_temp.t14_report('H1 anon selects crdt_documents', 'DENIED', case when n = 0 then 'DENIED (0 rows visible/affected)' else 'REACHED '||n::text||' rows' end);
  exception when others then perform pg_temp.t14_report('H1 anon selects crdt_documents','DENIED','DENIED ('||sqlstate||')'); end;
  reset role;

  begin
    execute 'set local role anon';
    select count(*) into n from public.server_document_chunk;
    perform pg_temp.t14_report('H2 anon selects server_document_chunk', 'DENIED', case when n = 0 then 'DENIED (0 rows visible/affected)' else 'REACHED '||n::text||' rows' end);
  exception when others then perform pg_temp.t14_report('H2 anon selects server_document_chunk','DENIED','DENIED ('||sqlstate||')'); end;
  reset role;

  begin
    execute 'set local role anon';
    select count(*) into n from public.workbench_blobs;
    perform pg_temp.t14_report('H3 anon selects workbench_blobs', 'DENIED', case when n = 0 then 'DENIED (0 rows visible/affected)' else 'REACHED '||n::text||' rows' end);
  exception when others then perform pg_temp.t14_report('H3 anon selects workbench_blobs','DENIED','DENIED ('||sqlstate||')'); end;
  reset role;

  begin
    execute 'set local role anon';
    select public.rpc_compact_document(d_a, '\xdead'::bytea, 1) into b;
    perform pg_temp.t14_report('H4 anon calls rpc_compact_document', 'DENIED', 'returned '||coalesce(b::text,'null'));
  exception when others then perform pg_temp.t14_report('H4 anon calls rpc_compact_document','DENIED','DENIED ('||sqlstate||')'); end;
  reset role;

  begin
    execute 'set local role anon';
    perform public.rpc_search_server_documents('x', array_fill(0.1::real, array[384])::extensions.vector(384), 'test-model', 5);
    perform pg_temp.t14_report('H5 anon calls rpc_search_server_documents', 'DENIED', 'EXECUTED');
  exception when others then perform pg_temp.t14_report('H5 anon calls rpc_search_server_documents','DENIED','DENIED ('||sqlstate||')'); end;
  reset role;

  raise notice '=== I. revoked-membership (suspended member keeps role row) ===';

  update public.space_memberships set status = 'suspended' where space_id = v_a and user_id = u_alice;
  begin perform pg_temp.t14_as(u_alice);
    select count(*) into n from public.crdt_documents where id = d_a;
    perform pg_temp.t14_report('I1 suspended member reads document', '0', n::text);
  exception when others then perform pg_temp.t14_report('I1 suspended member reads document','0','ERR '||sqlerrm); end;
  reset role;
  begin perform pg_temp.t14_as(u_alice);
    select public.rpc_compact_document(d_a, '\xdead'::bytea, 1) into b;
    perform pg_temp.t14_report('I2 suspended member compacts document', 'DENIED', 'returned '||coalesce(b::text,'null'));
  exception when others then perform pg_temp.t14_report('I2 suspended member compacts','DENIED','DENIED: '||sqlerrm); end;
  reset role;
  update public.space_memberships set status = 'active' where space_id = v_a and user_id = u_alice;

  raise notice '=== J. storage.objects policies for workbench-blobs ===';

  begin perform pg_temp.t14_as(u_mal);
    select count(*) into n from storage.objects where bucket_id = 'workbench-blobs';
    perform pg_temp.t14_report('J1 mallory lists workbench-blobs objects', '0', n::text);
  exception when others then perform pg_temp.t14_report('J1 mallory lists objects','0','ERR '||sqlerrm); end;
  reset role;

  -- mallory writes bytes into ALICE's space prefix. the insert policy checks
  -- space.files.create on the path's space segment, so this must fail.
  begin perform pg_temp.t14_as(u_mal);
    insert into storage.objects (bucket_id, name, owner, metadata)
    values ('workbench-blobs', 'spaces/'||v_a||'/blobs/'||repeat('d',64), u_mal, '{}'::jsonb);
    raise exception 'T14_UNDO' using errcode = 'P0001';
  exception
    when others then
      reset role;
      perform pg_temp.t14_report('J2 mallory writes object into alice space prefix', 'DENIED',
        case when sqlerrm = 'T14_UNDO' then 'INSERTED — space fence bypassed' else 'DENIED ('||sqlstate||')' end);
  end;
  reset role;

  -- the certification lifecycle, end to end, inside ONE subtransaction that is
  -- always undone: upload -> resumable update -> certificate row -> frozen.
  begin
    perform pg_temp.t14_as(u_alice);
    insert into storage.objects (bucket_id, name, owner, metadata)
    values ('workbench-blobs', 'spaces/'||v_a||'/blobs/'||repeat('e',64), u_alice, '{}'::jsonb);
    perform pg_temp.t14_report('J3 alice uploads into own space prefix', 'OK', 'OK');

    update storage.objects set metadata = '{"resumed":true}'::jsonb
    where bucket_id='workbench-blobs' and name='spaces/'||v_a||'/blobs/'||repeat('e',64);
    get diagnostics n = row_count;
    perform pg_temp.t14_report('J4 pre-certificate UPDATE allowed (resumable window)', 'OK',
      case when n = 1 then 'OK' else 'BLOCKED (0 rows) — resumable upload would break' end);

    reset role;
    insert into public.workbench_blobs (space_id, hash, size, mime, created_by)
    values (v_a, repeat('e',64), 5, 'text/plain', u_alice);
    perform pg_temp.t14_as(u_alice);

    update storage.objects set metadata = '{"tampered":true}'::jsonb
    where bucket_id='workbench-blobs' and name='spaces/'||v_a||'/blobs/'||repeat('e',64);
    get diagnostics n = row_count;
    perform pg_temp.t14_report('J5 post-certificate UPDATE frozen (immutability)', 'DENIED',
      case when n = 0 then 'DENIED (0 rows visible/affected)' else 'REACHED '||n::text||' rows' end);

    -- J6: storage installs a trigger that refuses direct SQL deletion of object
    -- rows ("use the Storage API"), so it aborts the subtransaction before RLS
    -- is consulted. That is a STRONGER denial than the missing DELETE policy we
    -- were probing for, but it fires as an exception rather than 0 rows, so the
    -- attempt is made in its own block to keep the lifecycle assertions above.
    begin
      delete from storage.objects
      where bucket_id='workbench-blobs' and name='spaces/'||v_a||'/blobs/'||repeat('e',64);
      get diagnostics n = row_count;
      perform pg_temp.t14_report('J6 client deletes own blob bytes', 'DENIED',
        case when n = 0 then 'DENIED (0 rows visible/affected)' else 'REACHED '||n::text||' rows' end);
    exception when others then
      perform pg_temp.t14_report('J6 client deletes own blob bytes', 'DENIED', 'DENIED ('||sqlstate||') storage trigger');
    end;

    raise exception 'T14_UNDO' using errcode = 'P0001';
  exception
    when others then
      reset role;
      if sqlerrm <> 'T14_UNDO' then
        perform pg_temp.t14_report('J3-J6 certification lifecycle', 'completed', 'ABORTED ('||sqlstate||') '||sqlerrm);
      end if;
  end;
  reset role;

  raise notice '=== L. writer-field spoofing and log integrity ===';

  -- `writer` is only an echo-suppression hint, but confirm it cannot be used to
  -- forge a row attributed to another user while created_by stays JWT-bound.
  begin perform pg_temp.t14_as(u_alice);
    insert into public.crdt_updates (doc_id, bytes, writer, created_by)
    values (d_a, '\x05'::bytea, 'inst-of-someone-else', u_alice);
    select created_by = u_alice into b from public.crdt_updates where doc_id=d_a order by seq desc limit 1;
    perform pg_temp.t14_report('L1 spoofed writer cannot forge created_by', 'true', coalesce(b::text,'null'));
  exception when others then perform pg_temp.t14_report('L1 spoofed writer','true','ERR '||sqlerrm); end;
  reset role;

  -- compaction must never delete rows that arrived after the covered watermark.
  begin
    perform pg_temp.t14_as(u_alice);
    insert into public.crdt_updates (doc_id, bytes, writer, created_by) values (d_a, '\x06'::bytea, 'inst-late', u_alice);
    select max(u.seq) into n from public.crdt_updates u where u.doc_id = d_a;
    -- cover everything EXCEPT the newest row, then prove the newest row survives
    select public.rpc_compact_document(d_a, '\xcafe'::bytea, n - 1) into b;
    select count(*) into n from public.crdt_updates where doc_id = d_a;
    perform pg_temp.t14_report('L2 rows past covers_seq survive compaction', 'SURVIVED',
      case when n > 0 then 'SURVIVED ('||n::text||' row(s) left)' else 'DATA LOSS: later rows deleted' end);
    raise exception 'T14_UNDO' using errcode = 'P0001';
  exception
    when others then
      reset role;
      if sqlerrm <> 'T14_UNDO' then
        perform pg_temp.t14_report('L2 rows past covers_seq survive','SURVIVED','ERR '||sqlerrm);
      end if;
  end;
  reset role;

  raise notice '=== K. legitimate happy path still works (no over-fencing) ===';

  begin perform pg_temp.t14_as(u_alice);
    insert into public.crdt_updates (doc_id, bytes, writer, created_by) values (d_a, '\x04'::bytea, 'inst-alice', u_alice);
    perform pg_temp.t14_report('K1 alice pushes update to own doc', 'OK', 'OK');
  exception when others then perform pg_temp.t14_report('K1 alice pushes update','OK','FAILED: '||sqlerrm); end;
  reset role;

  begin perform pg_temp.t14_as(u_alice);
    select public.rpc_compact_document(d_a, '\xdeadbeef'::bytea, 2) into b;
    perform pg_temp.t14_report('K2 alice compacts own doc through the rpc', 'true', coalesce(b::text,'null'));
  exception when others then perform pg_temp.t14_report('K2 alice compacts own doc','true','ERR '||sqlerrm); end;
  reset role;

  begin perform pg_temp.t14_as(u_adam);
    delete from public.crdt_documents where id = d_a;
    get diagnostics n = row_count;
    perform pg_temp.t14_report('K3 admin deletes document', '1', n::text);
  exception when others then perform pg_temp.t14_report('K3 admin deletes document','1','ERR '||sqlerrm); end;
  reset role;
end
$probe$;

-- ---------------------------------------------------------------------------
-- M. atomic move: one canonical parent, explicit refusal, cycle rollback
-- ---------------------------------------------------------------------------
do $move$
declare
  v_a text; v_b text; u_alice uuid; u_mal uuid;
  f1 text; f2 text; leaf text; child_of_leaf text;
  n int; parent_id text;
begin
  select v into v_a from t14_ids where k='space_a';
  select v into v_b from t14_ids where k='space_b';
  select v::uuid into u_alice from t14_ids where k='alice';
  select v::uuid into u_mal   from t14_ids where k='mallory';

  raise notice '=== M. atomic move_knowledge_resource ===';

  -- fixture as owner: two folders, a leaf under f1, a grandchild under leaf.
  insert into public.knowledge_resources (space_id, kind, title, created_by, owner_user_id)
  values (v_a, 'folder', 'M f1', u_alice, u_alice) returning id into f1;
  insert into public.knowledge_resources (space_id, kind, title, created_by, owner_user_id)
  values (v_a, 'folder', 'M f2', u_alice, u_alice) returning id into f2;
  insert into public.knowledge_resources (space_id, kind, title, created_by, owner_user_id)
  values (v_a, 'folder', 'M leaf', u_alice, u_alice) returning id into leaf;
  insert into public.knowledge_resources (space_id, kind, title, created_by, owner_user_id)
  values (v_a, 'text', 'M grandchild', u_alice, u_alice) returning id into child_of_leaf;
  insert into public.knowledge_edges (space_id, from_id, to_id, relation_type, position, created_by)
  values (v_a, f1, leaf, 'contains', 0, u_alice),
         (v_a, leaf, child_of_leaf, 'contains', 0, u_alice);

  -- (a) move into a folder: exactly one incoming contains, from f2
  begin perform pg_temp.t14_as(u_alice);
    perform public.move_knowledge_resource(v_a, leaf, f2, 3);
    select count(*) into n from public.knowledge_edges where to_id = leaf and relation_type = 'contains';
    select from_id into parent_id from public.knowledge_edges where to_id = leaf and relation_type = 'contains';
    perform pg_temp.t14_report('M1 move into folder: one parent = target', '1:'||f2, n::text||':'||coalesce(parent_id,'null'));
  exception when others then perform pg_temp.t14_report('M1 move into folder','1:'||f2,'ERR ('||sqlstate||') '||sqlerrm); end;
  reset role;

  -- (c) same call again: state unchanged
  begin perform pg_temp.t14_as(u_alice);
    perform public.move_knowledge_resource(v_a, leaf, f2, 3);
    select count(*) into n from public.knowledge_edges where to_id = leaf and relation_type = 'contains' and from_id = f2;
    perform pg_temp.t14_report('M2 redelivered move is a no-op', '1', n::text);
  exception when others then perform pg_temp.t14_report('M2 redelivered move','1','ERR ('||sqlstate||') '||sqlerrm); end;
  reset role;

  -- (d) two sequential moves: the later one wins, still one parent
  begin perform pg_temp.t14_as(u_alice);
    perform public.move_knowledge_resource(v_a, leaf, f1, 0);
    perform public.move_knowledge_resource(v_a, leaf, f2, 0);
    select count(*) into n from public.knowledge_edges where to_id = leaf and relation_type = 'contains';
    select from_id into parent_id from public.knowledge_edges where to_id = leaf and relation_type = 'contains';
    perform pg_temp.t14_report('M3 later move wins, one parent', '1:'||f2, n::text||':'||coalesce(parent_id,'null'));
  exception when others then perform pg_temp.t14_report('M3 later move wins','1:'||f2,'ERR ('||sqlstate||') '||sqlerrm); end;
  reset role;

  -- (b) move to top level: no incoming contains
  begin perform pg_temp.t14_as(u_alice);
    perform public.move_knowledge_resource(v_a, leaf, null, 0);
    select count(*) into n from public.knowledge_edges where to_id = leaf and relation_type = 'contains';
    perform pg_temp.t14_report('M4 move to top level: zero parents', '0', n::text);
  exception when others then perform pg_temp.t14_report('M4 move to top level','0','ERR ('||sqlstate||') '||sqlerrm); end;
  reset role;

  -- re-attach under f1 in its own block: the probes below start from a known parent
  -- and must not share a subtransaction with a probe that is expected to raise
  -- (a raise rolls the whole begin..exception block back).
  begin perform pg_temp.t14_as(u_alice);
    perform public.move_knowledge_resource(v_a, leaf, f1, 0);
  exception when others then perform pg_temp.t14_report('M5a re-attach under f1','OK','ERR ('||sqlstate||') '||sqlerrm); end;
  reset role;

  -- (e) a direct second contains edge is refused by the index
  begin perform pg_temp.t14_as(u_alice);
    insert into public.knowledge_edges (space_id, from_id, to_id, relation_type, position, created_by)
    values (v_a, f2, leaf, 'contains', 0, u_alice);
    perform pg_temp.t14_report('M5 second contains edge refused by index', 'DENIED', 'ALLOWED');
  exception when unique_violation then perform pg_temp.t14_report('M5 second contains edge refused by index', 'DENIED', 'DENIED ('||sqlstate||')');
          when others then perform pg_temp.t14_report('M5 second contains edge','DENIED','ERR ('||sqlstate||') '||sqlerrm); end;
  reset role;

  -- (f) cross-space caller: explicit refusal, graph untouched
  begin perform pg_temp.t14_as(u_mal);
    perform public.move_knowledge_resource(v_a, leaf, f2, 0);
    perform pg_temp.t14_report('M6 cross-space move refused', 'DENIED', 'ALLOWED');
  exception when insufficient_privilege then perform pg_temp.t14_report('M6 cross-space move refused', 'DENIED', 'DENIED ('||sqlstate||')');
          when others then perform pg_temp.t14_report('M6 cross-space move','DENIED','ERR ('||sqlstate||') '||sqlerrm); end;
  reset role;
  select from_id into parent_id from public.knowledge_edges where to_id = leaf and relation_type = 'contains';
  perform pg_temp.t14_report('M6b graph unchanged after refusal', f1, coalesce(parent_id,'null'));

  -- (g) cycle: moving leaf under its own grandchild is refused and the old parent survives
  begin perform pg_temp.t14_as(u_alice);
    perform public.move_knowledge_resource(v_a, leaf, child_of_leaf, 0);
    perform pg_temp.t14_report('M7 cycle refused', 'DENIED', 'ALLOWED');
  exception when raise_exception then perform pg_temp.t14_report('M7 cycle refused', 'DENIED', 'DENIED ('||sqlstate||')');
          when others then perform pg_temp.t14_report('M7 cycle','DENIED','ERR ('||sqlstate||') '||sqlerrm); end;
  reset role;
  select from_id into parent_id from public.knowledge_edges where to_id = leaf and relation_type = 'contains';
  perform pg_temp.t14_report('M7b prior parent kept after cycle rollback', f1, coalesce(parent_id,'null'));
end
$move$;

-- ---------------------------------------------------------------------------
-- N. the body fence: a space member reaches a document body only through the
--    resource that owns it, with the floor and grants the resource has.
--    reads follow the resource read rule; writes follow the resource update
--    rule (creator, or readable through the resource AND the space update
--    verb — a member holds read but not that verb).
--    the section builds its own documents: earlier sections delete and
--    compact the fixture ones. counts use the two rows seeded by alice so a
--    probe that unexpectedly writes cannot shift a later count; such stray
--    rows are removed at once.
-- ---------------------------------------------------------------------------
do $fence$
declare
  v_a text; v_b text; u_alice uuid; u_adam uuid; u_bob uuid; u_mal uuid;
  d_f text; d_orphan text; res_f text; ver_f text; forged text;
  n int; b boolean;
begin
  select v into v_a from t14_ids where k='space_a';
  select v into v_b from t14_ids where k='space_b';
  select v::uuid into u_alice from t14_ids where k='alice';
  select v::uuid into u_adam  from t14_ids where k='adam';
  select v::uuid into u_bob   from t14_ids where k='bob';
  select v::uuid into u_mal   from t14_ids where k='mallory';

  -- alice's PRIVATE resource owns d_f, the only legitimate link to its body
  insert into public.crdt_documents (space_id, created_by) values (v_a, u_alice) returning id into d_f;
  insert into public.crdt_updates (doc_id, bytes, writer, created_by) values
    (d_f, '\x01'::bytea, 'inst-alice', u_alice),
    (d_f, '\x02'::bytea, 'inst-alice', u_alice);
  insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id, body_ref)
  values (v_a, 'text', 'Alice private note', 'private', u_alice, u_alice, jsonb_build_object('doc_id', d_f))
  returning id into res_f;
  -- a named version, and the server search rows, follow the same fence
  insert into public.crdt_document_versions (doc_id, label, kind, frontiers, created_by)
  values (d_f, 'v1', 'manual', '[]'::jsonb, u_alice) returning id into ver_f;
  insert into public.server_document_index_state (document_id, space_id, title, indexed_watermark, model_id)
  values (d_f, v_a, 'Alice fenced note', 2, 'test-model');
  insert into public.server_document_chunk (document_id, space_id, ord, char_start, text, embedding, model_id)
  values (d_f, v_a, 0, 0, 'alice fenced note body', array_fill(0.1::real, array[384])::extensions.vector(384), 'test-model');
  -- a body with NO resource row at all (its resource create was refused or has
  -- not been pushed yet): visible to its creator only
  insert into public.crdt_documents (space_id, created_by) values (v_a, u_alice) returning id into d_orphan;
  insert into public.crdt_updates (doc_id, bytes, writer, created_by) values (d_orphan, '\x09'::bytea, 'inst-alice', u_alice);

  raise notice '=== N. body fence (bob: member in A, owns nothing) ===';

  -- (1) private resource: bob reads nothing and writes nothing
  begin perform pg_temp.t14_as(u_bob);
    select count(*) into n from public.crdt_documents where id = d_f;
    perform pg_temp.t14_report('N1 private body: crdt_documents hidden from member', '0', n::text);
  exception when others then perform pg_temp.t14_report('N1 private body: crdt_documents hidden from member','0','ERR '||sqlerrm); end;
  reset role;

  begin perform pg_temp.t14_as(u_bob);
    select count(*) into n from public.crdt_updates where doc_id = d_f and writer = 'inst-alice';
    perform pg_temp.t14_report('N2 private body: crdt_updates hidden from member', '0', n::text);
  exception when others then perform pg_temp.t14_report('N2 private body: crdt_updates hidden from member','0','ERR '||sqlerrm); end;
  reset role;

  begin perform pg_temp.t14_as(u_bob);
    insert into public.crdt_updates (doc_id, bytes, writer, created_by) values (d_f, '\xb0'::bytea, 'inst-bob', u_bob);
    perform pg_temp.t14_report('N3 private body: member cannot push an update', 'DENIED', 'ALLOWED');
  exception when insufficient_privilege then perform pg_temp.t14_report('N3 private body: member cannot push an update', 'DENIED', 'DENIED ('||sqlstate||')');
          when others then perform pg_temp.t14_report('N3 private body: member cannot push an update','DENIED','ERR ('||sqlstate||') '||sqlerrm); end;
  reset role;
  delete from public.crdt_updates where doc_id = d_f and writer = 'inst-bob';

  begin perform pg_temp.t14_as(u_bob);
    select count(*) into n from public.server_document_chunk where document_id = d_f;
    perform pg_temp.t14_report('N4 private body: search chunks hidden from member', '0', n::text);
  exception when others then perform pg_temp.t14_report('N4 private body: search chunks hidden from member','0','ERR '||sqlerrm); end;
  reset role;

  begin perform pg_temp.t14_as(u_bob);
    select count(*) into n from public.server_document_index_state where document_id = d_f;
    perform pg_temp.t14_report('N5 private body: index state hidden from member', '0', n::text);
  exception when others then perform pg_temp.t14_report('N5 private body: index state hidden from member','0','ERR '||sqlerrm); end;
  reset role;

  begin perform pg_temp.t14_as(u_bob);
    select count(*) into n from public.crdt_document_versions where id = ver_f;
    perform pg_temp.t14_report('N6 private body: versions hidden from member', '0', n::text);
  exception when others then perform pg_temp.t14_report('N6 private body: versions hidden from member','0','ERR '||sqlerrm); end;
  reset role;

  -- (2) the owner shares the resource at the space floor: reading follows
  perform pg_temp.t14_as(u_alice);
  update public.knowledge_resources set visibility = 'space' where id = res_f;
  reset role;

  begin perform pg_temp.t14_as(u_bob);
    select count(*) into n from public.crdt_documents where id = d_f;
    perform pg_temp.t14_report('N7 space floor: crdt_documents visible to member', '1', n::text);
  exception when others then perform pg_temp.t14_report('N7 space floor: crdt_documents visible to member','1','ERR '||sqlerrm); end;
  reset role;

  begin perform pg_temp.t14_as(u_bob);
    select count(*) into n from public.crdt_updates where doc_id = d_f and writer = 'inst-alice';
    perform pg_temp.t14_report('N8 space floor: crdt_updates visible to member', '2', n::text);
  exception when others then perform pg_temp.t14_report('N8 space floor: crdt_updates visible to member','2','ERR '||sqlerrm); end;
  reset role;

  -- ...but writing needs the resource update rule: a member reads a shared
  -- document and does not edit it; an admin does
  begin perform pg_temp.t14_as(u_bob);
    insert into public.crdt_updates (doc_id, bytes, writer, created_by) values (d_f, '\xb1'::bytea, 'inst-bob', u_bob);
    perform pg_temp.t14_report('N9 space floor: member cannot push an update', 'DENIED', 'ALLOWED');
  exception when insufficient_privilege then perform pg_temp.t14_report('N9 space floor: member cannot push an update', 'DENIED', 'DENIED ('||sqlstate||')');
          when others then perform pg_temp.t14_report('N9 space floor: member cannot push an update','DENIED','ERR ('||sqlstate||') '||sqlerrm); end;
  reset role;
  delete from public.crdt_updates where doc_id = d_f and writer = 'inst-bob';

  begin perform pg_temp.t14_as(u_adam);
    insert into public.crdt_updates (doc_id, bytes, writer, created_by) values (d_f, '\xad'::bytea, 'inst-adam', u_adam);
    perform pg_temp.t14_report('N9b space floor: admin can push an update', 'OK', 'OK');
  exception when others then perform pg_temp.t14_report('N9b space floor: admin can push an update','OK','ERR ('||sqlstate||') '||sqlerrm); end;
  reset role;

  -- (3) back to private: the member loses the body again
  perform pg_temp.t14_as(u_alice);
  update public.knowledge_resources set visibility = 'private' where id = res_f;
  reset role;

  begin perform pg_temp.t14_as(u_bob);
    select count(*) into n from public.crdt_updates where doc_id = d_f and writer = 'inst-alice';
    perform pg_temp.t14_report('N10 back to private: crdt_updates hidden again', '0', n::text);
  exception when others then perform pg_temp.t14_report('N10 back to private: crdt_updates hidden again','0','ERR '||sqlerrm); end;
  reset role;

  -- (4) a per-user grant is a READ grant: bob reads, bob does not write
  insert into public.knowledge_resource_user_grants (resource_id, user_id, granted_by) values (res_f, u_bob, u_alice);

  begin perform pg_temp.t14_as(u_bob);
    select count(*) into n from public.crdt_updates where doc_id = d_f and writer = 'inst-alice';
    perform pg_temp.t14_report('N11 per-user grant: crdt_updates visible to grantee', '2', n::text);
  exception when others then perform pg_temp.t14_report('N11 per-user grant: crdt_updates visible to grantee','2','ERR '||sqlerrm); end;
  reset role;

  begin perform pg_temp.t14_as(u_bob);
    insert into public.crdt_updates (doc_id, bytes, writer, created_by) values (d_f, '\xb2'::bytea, 'inst-bob', u_bob);
    perform pg_temp.t14_report('N12 per-user grant: grantee cannot push', 'DENIED', 'ALLOWED');
  exception when insufficient_privilege then perform pg_temp.t14_report('N12 per-user grant: grantee cannot push', 'DENIED', 'DENIED ('||sqlstate||')');
          when others then perform pg_temp.t14_report('N12 per-user grant: grantee cannot push','DENIED','ERR ('||sqlstate||') '||sqlerrm); end;
  reset role;
  delete from public.crdt_updates where doc_id = d_f and writer = 'inst-bob';

  delete from public.knowledge_resource_user_grants where resource_id = res_f and user_id = u_bob;

  begin perform pg_temp.t14_as(u_bob);
    select count(*) into n from public.crdt_updates where doc_id = d_f and writer = 'inst-alice';
    perform pg_temp.t14_report('N13 grant revoked: crdt_updates hidden again', '0', n::text);
  exception when others then perform pg_temp.t14_report('N13 grant revoked: crdt_updates hidden again','0','ERR '||sqlerrm); end;
  reset role;

  -- (5) a forged link: bob's OWN resource naming alice's document grants nothing
  --     (a resource counts as the body's owner only when its owner is the
  --     document's creator)
  insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id, body_ref)
  values (v_a, 'text', 'Bob forged link', 'private', u_bob, u_bob, jsonb_build_object('doc_id', d_f))
  returning id into forged;

  begin perform pg_temp.t14_as(u_bob);
    select count(*) into n from public.crdt_documents where id = d_f;
    perform pg_temp.t14_report('N14 forged body_ref by another owner grants nothing', '0', n::text);
  exception when others then perform pg_temp.t14_report('N14 forged body_ref by another owner grants nothing','0','ERR '||sqlerrm); end;
  reset role;
  delete from public.knowledge_resources where id = forged;

  -- (6) an orphan body (no resource row at all): its creator only
  begin perform pg_temp.t14_as(u_alice);
    select count(*) into n from public.crdt_updates where doc_id = d_orphan;
    perform pg_temp.t14_report('N15a orphan body: creator reads it', '1', n::text);
  exception when others then perform pg_temp.t14_report('N15a orphan body: creator reads it','1','ERR '||sqlerrm); end;
  reset role;

  begin perform pg_temp.t14_as(u_alice);
    insert into public.crdt_updates (doc_id, bytes, writer, created_by) values (d_orphan, '\x0a'::bytea, 'inst-alice-2', u_alice);
    perform pg_temp.t14_report('N15b orphan body: creator pushes to it', 'OK', 'OK');
  exception when others then perform pg_temp.t14_report('N15b orphan body: creator pushes to it','OK','ERR ('||sqlstate||') '||sqlerrm); end;
  reset role;

  begin perform pg_temp.t14_as(u_bob);
    select count(*) into n from public.crdt_updates where doc_id = d_orphan;
    perform pg_temp.t14_report('N15c orphan body: member sees nothing', '0', n::text);
  exception when others then perform pg_temp.t14_report('N15c orphan body: member sees nothing','0','ERR '||sqlerrm); end;
  reset role;

  -- (7) compaction, the one destructive write, follows the write side
  begin perform pg_temp.t14_as(u_bob);
    select public.rpc_compact_document(d_f, '\xff'::bytea, 1) into b;
    perform pg_temp.t14_report('N16a private body: member cannot compact', 'DENIED', 'ALLOWED ('||coalesce(b::text,'null')||')');
  exception when raise_exception then perform pg_temp.t14_report('N16a private body: member cannot compact', 'DENIED', 'DENIED ('||sqlerrm||')');
          when others then perform pg_temp.t14_report('N16a private body: member cannot compact','DENIED','ERR ('||sqlstate||') '||sqlerrm); end;
  reset role;

  begin perform pg_temp.t14_as(u_alice);
    select public.rpc_compact_document(d_f, '\xff'::bytea, 2) into b;
    perform pg_temp.t14_report('N16b private body: creator compacts', 'true', coalesce(b::text,'null'));
  exception when others then perform pg_temp.t14_report('N16b private body: creator compacts','true','ERR ('||sqlstate||') '||sqlerrm); end;
  reset role;

  -- (8) purge of the resource: the body falls back to its creator only
  perform pg_temp.t14_as(u_alice);
  update public.knowledge_resources set visibility = 'space' where id = res_f;
  delete from public.knowledge_resources where id = res_f;
  reset role;

  begin perform pg_temp.t14_as(u_bob);
    select count(*) into n from public.crdt_documents where id = d_f;
    perform pg_temp.t14_report('N17a resource purged: member loses the body', '0', n::text);
  exception when others then perform pg_temp.t14_report('N17a resource purged: member loses the body','0','ERR '||sqlerrm); end;
  reset role;

  begin perform pg_temp.t14_as(u_alice);
    select count(*) into n from public.crdt_documents where id = d_f;
    perform pg_temp.t14_report('N17b resource purged: creator keeps the body', '1', n::text);
  exception when others then perform pg_temp.t14_report('N17b resource purged: creator keeps the body','1','ERR '||sqlerrm); end;
  reset role;

  -- (9) the same-space clause, isolated: a resource in space B, owned by the
  --     document's creator, naming the document, opened to bob (not a member
  --     of B) by a per-user grant. the grant alone would let bob read it, so
  --     only the same-space condition keeps the body shut. a grant needs an
  --     active member of the resource's space, so bob joins B for this probe.
  insert into public.space_memberships (space_id, user_id, status) values (v_b, u_bob, 'active');
  insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id, body_ref)
  values (v_b, 'text', 'Alice forged link in B', 'private', u_alice, u_alice, jsonb_build_object('doc_id', d_f))
  returning id into forged;
  insert into public.knowledge_resource_user_grants (resource_id, user_id, granted_by) values (forged, u_bob, u_alice);

  begin perform pg_temp.t14_as(u_bob);
    select count(*) into n from public.crdt_documents where id = d_f;
    perform pg_temp.t14_report('N18 link from another space grants nothing', '0', n::text);
  exception when others then perform pg_temp.t14_report('N18 link from another space grants nothing','0','ERR '||sqlerrm); end;
  reset role;
  delete from public.knowledge_resource_user_grants where resource_id = forged;
  delete from public.knowledge_resources where id = forged;
  delete from public.space_memberships where space_id = v_b and user_id = u_bob;

  -- (10) regression guard: an admin of space B with a space-floor resource of
  --      her own naming the document still reads nothing of space A
  insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id, body_ref)
  values (v_b, 'text', 'Mallory forged link', 'space', u_mal, u_mal, jsonb_build_object('doc_id', d_f))
  returning id into forged;

  begin perform pg_temp.t14_as(u_mal);
    select count(*) into n from public.crdt_documents where id = d_f;
    perform pg_temp.t14_report('N18b cross-space admin with a forged link reads nothing', '0', n::text);
  exception when others then perform pg_temp.t14_report('N18b cross-space admin with a forged link reads nothing','0','ERR '||sqlerrm); end;
  reset role;
  delete from public.knowledge_resources where id = forged;
end
$fence$;

rollback;
