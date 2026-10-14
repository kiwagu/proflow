-- Mirror probe for the write scope: what rpc_my_write_scope tells a person
-- they may change must be exactly what the row-level policies let them do.
--
-- WHAT THIS IS FOR
--   The workbench hides what the server would refuse, from a snapshot the
--   server derives from the same role verbs its write policies use. The
--   snapshot is a second statement of those rules; this script is what keeps
--   it equal to the first. For every role x row (my own / someone else's) x
--   action, it compares two outcomes:
--     verdict  the snapshot's answer, applied to the row the way the client
--              applies it (all -> yes, none -> no, own -> a named column of
--              the row is me);
--     actual   a trial write as that user under RLS, rolled back.
--   A line reads PASS only when both say the same. A disagreement is either
--   a wrong snapshot or a policy that changed shape; both need a decision.
--
-- HOW TO RUN (against a stand, never production)
--   docker exec -i <db-container> psql -U postgres -d postgres \
--     -f supabase/tests/write_scope_mirror.sql
--
-- SAFETY
--   One transaction, ending in ROLLBACK; every trial write runs in its own
--   subtransaction that is undone whether it succeeded or not.
--
-- FIXTURE
--   one space; member, author and admin, each a member of it with that
--   system role; two space-wide folders owned by the admin; for each user one
--   space-wide document filed by that user into the first folder, its body
--   registered by that user under it, and one top-level node of their own
--   (purge is tried on those: purging a node that someone else's folder
--   still holds is refused by the in-use guard whatever the verbs, a case
--   the snapshot does not try to express).

begin;

create temporary table ws_ids (k text primary key, v text);

do $fixture$
declare
  v_org text; v_s text;
  u_m uuid := gen_random_uuid();
  u_a uuid := gen_random_uuid();
  u_d uuid := gen_random_uuid();
  u_x uuid := gen_random_uuid();
  r_member text; r_author text; r_admin text;
  f1 text; f2 text; n text; t text; d text; u uuid;
begin
  insert into public.organizations (name, slug) values ('WS Org', 'ws-org-' || substr(md5(random()::text),1,8)) returning id into v_org;
  insert into public.spaces (organization_id, name, slug) values (v_org, 'WS', 'ws-' || substr(md5(random()::text),1,8)) returning id into v_s;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  select x, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ws-'||x||'@ws.invalid', '', now(), now(), now()
  from unnest(array[u_m, u_a, u_d, u_x]) as x;
  insert into public.profiles (user_id, email, display_name)
  select x, 'ws-'||x||'@ws.invalid', 'WS' from unnest(array[u_m, u_a, u_d, u_x]) as x
  on conflict (user_id) do nothing;

  -- u_x is not a member of the space at all.
  insert into public.space_memberships (space_id, user_id, status) values
    (v_s, u_m, 'active'), (v_s, u_a, 'active'), (v_s, u_d, 'active');

  select id into r_member from public.roles where key='member' and role_kind='system' and owner_organization_id is null and archived_at is null limit 1;
  select id into r_author from public.roles where key='author' and role_kind='system' and owner_organization_id is null and archived_at is null limit 1;
  select id into r_admin  from public.roles where key='admin'  and role_kind='system' and owner_organization_id is null and archived_at is null limit 1;
  insert into public.user_role (user_id, role_id, space_id, organization_id) values
    (u_m, r_member, v_s, null), (u_a, r_author, v_s, null), (u_d, r_admin, v_s, null);

  insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
  values (v_s, 'folder', 'Folder one', 'space', u_d, u_d) returning id into f1;
  insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
  values (v_s, 'folder', 'Folder two', 'space', u_d, u_d) returning id into f2;

  foreach u in array array[u_m, u_a, u_d] loop
    d := public.entity_id_generate('doc');
    insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id, body_ref)
    values (v_s, 'text', 'Doc of ' || u, 'space', u, u, jsonb_build_object('doc_id', d)) returning id into n;
    insert into public.knowledge_edges (space_id, from_id, to_id, relation_type, position, created_by)
    values (v_s, f1, n, 'contains', 0, u);
    insert into public.crdt_documents (id, space_id, created_by, resource_id) values (d, v_s, u, n);
    insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
    values (v_s, 'text', 'Top of ' || u, 'space', u, u) returning id into t;
    insert into ws_ids values ('node:' || u, n), ('doc:' || u, d), ('top:' || u, t);
  end loop;

  -- a folder of the member's that the admin filed a node of their own into
  insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
  values (v_s, 'folder', 'Member folder', 'space', u_m, u_m) returning id into n;
  insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
  values (v_s, 'text', 'Admin note in it', 'space', u_d, u_d) returning id into t;
  insert into public.knowledge_edges (space_id, from_id, to_id, relation_type, position, created_by)
  values (v_s, n, t, 'contains', 0, u_d);
  insert into ws_ids values ('mixed_folder', n);

  insert into ws_ids values ('space', v_s), ('f1', f1), ('f2', f2),
    ('member', u_m::text), ('author', u_a::text), ('admin', u_d::text), ('stranger', u_x::text);
end
$fixture$;

create or replace function pg_temp.ws_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'role','authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.ws_report(p_id text, p_verdict boolean, p_actual boolean, p_detail text) returns void language plpgsql as $$
begin
  raise notice '% | % | verdict=% actual=% %',
    case when p_verdict is not distinct from p_actual then 'PASS' else '*** FAIL ***' end,
    p_id, p_verdict, p_actual, coalesce(p_detail, '');
end $$;

-- The client's rule, restated: all -> yes, none -> no, own -> one of the
-- named columns of the row is me, or one of the orUnset columns is empty
-- (nothing there to take away: a node with no place yet).
create or replace function pg_temp.ws_allowed(p_scope jsonb, p_action text, p_owner uuid, p_edge_creator uuid, p_me uuid) returns boolean language sql as $$
  select case
    when p_scope -> p_action = to_jsonb('all'::text) then true
    when p_scope -> p_action = to_jsonb('none'::text) then false
    else exists (
      select 1 from jsonb_array_elements_text(p_scope -> p_action -> 'own') as c(col)
      where (c.col = 'owner_user_id' and p_owner = p_me)
         or (c.col = 'parent_edge_created_by' and p_edge_creator = p_me)
    ) or exists (
      select 1 from jsonb_array_elements_text(coalesce(p_scope -> p_action -> 'orUnset', '[]'::jsonb)) as c(col)
      where (c.col = 'parent_edge_created_by' and p_edge_creator is null)
         or (c.col = 'owner_user_id' and p_owner is null)
    )
  end
$$;

do $probe$
declare
  v_s text; f1 text; f2 text;
  roles text[] := array['member', 'author', 'admin'];
  role_name text; target text;
  me uuid; other uuid; tgt_owner uuid; tgt_node text; tgt_doc text; tgt_top text; edge_creator uuid;
  scope jsonb; verdict boolean; actual boolean; n int; detail text;
  action text;
  actions text[] := array['node.update', 'node.trash', 'node.purge', 'node.move', 'node.create', 'node.star', 'body.write'];
begin
  select v into v_s from ws_ids where k = 'space';
  select v into f1 from ws_ids where k = 'f1';
  select v into f2 from ws_ids where k = 'f2';

  foreach role_name in array roles loop
    select v::uuid into me from ws_ids where k = role_name;
    -- someone else's row: the admin's for the member and the author, the
    -- author's for the admin.
    select v::uuid into other from ws_ids where k = case when role_name = 'admin' then 'author' else 'admin' end;

    perform pg_temp.ws_as(me);
    scope := public.rpc_my_write_scope(v_s);
    reset role;

    foreach target in array array['own', 'other'] loop
      tgt_owner := case when target = 'own' then me else other end;
      select v into tgt_node from ws_ids where k = 'node:' || tgt_owner;
      select v into tgt_doc  from ws_ids where k = 'doc:'  || tgt_owner;
      select v into tgt_top  from ws_ids where k = 'top:'  || tgt_owner;
      edge_creator := tgt_owner;  -- each user filed their own document

      foreach action in array actions loop
        verdict := pg_temp.ws_allowed(scope, action, tgt_owner, edge_creator, me);
        actual := false; detail := null;
        begin
          perform pg_temp.ws_as(me);
          case action
            when 'node.update' then
              update public.knowledge_resources set title = 'renamed' where id = tgt_node;
              get diagnostics n = row_count; actual := n > 0;
            when 'node.trash' then
              update public.knowledge_resources set deleted_at = now(), trashed_by = me where id = tgt_node;
              get diagnostics n = row_count; actual := n > 0;
            when 'node.purge' then
              delete from public.knowledge_resources where id = tgt_top;
              get diagnostics n = row_count; actual := n > 0;
            when 'node.move' then
              perform public.move_knowledge_resource(v_s, tgt_node, f2, 0);
              actual := exists (select 1 from public.knowledge_edges where to_id = tgt_node and from_id = f2 and relation_type = 'contains');
            when 'node.create' then
              insert into public.knowledge_resources (space_id, kind, title, visibility, created_by, owner_user_id)
              values (v_s, 'text', 'new', 'private', me, me);
              actual := true;
            when 'node.star' then
              insert into public.resource_user_state (user_id, resource_id, space_id, starred)
              values (me, tgt_node, v_s, true)
              on conflict (user_id, resource_id) do update set starred = true;
              actual := true;
            when 'body.write' then
              insert into public.crdt_updates (doc_id, bytes, writer, created_by)
              values (tgt_doc, '\x01'::bytea, 'ws-probe', me);
              actual := true;
          end case;
          raise exception using errcode = 'P0001', message = 'undo';
        exception
          when sqlstate 'P0001' then null;  -- the write went through; undone
          when others then actual := false; detail := '(' || sqlstate || ')';
        end;
        reset role;
        perform pg_temp.ws_report(role_name || ' / ' || target || ' / ' || action, verdict, actual, detail);
      end loop;
    end loop;
    -- a node with no place yet: moving it takes nothing away, so the move
    -- needs only the create verb, whoever owns the node.
    foreach target in array array['own', 'other'] loop
      tgt_owner := case when target = 'own' then me else other end;
      select v into tgt_top from ws_ids where k = 'top:' || tgt_owner;
      verdict := pg_temp.ws_allowed(scope, 'node.move', tgt_owner, null, me);
      actual := false; detail := null;
      begin
        perform pg_temp.ws_as(me);
        perform public.move_knowledge_resource(v_s, tgt_top, f2, 0);
        actual := exists (select 1 from public.knowledge_edges where to_id = tgt_top and from_id = f2 and relation_type = 'contains');
        raise exception using errcode = 'P0001', message = 'undo';
      exception
        when sqlstate 'P0001' then null;
        when others then actual := false; detail := '(' || sqlstate || ')';
      end;
      reset role;
      perform pg_temp.ws_report(role_name || ' / ' || target || ' top level / node.move', verdict, actual, detail);
    end loop;
  end loop;


  -- documented exception: the snapshot answers per row, and for the member
  -- their own folder is theirs to trash; trashing it trashes what it holds,
  -- and the server refuses to trash someone else's node without the delete
  -- verb. the client checks the part of the subtree it can see; this line
  -- asserts the server behaviour that check mirrors.
  declare mixed text; m uuid;
  begin
    select v into mixed from ws_ids where k = 'mixed_folder';
    select v::uuid into m from ws_ids where k = 'member';
    actual := false; detail := null;
    begin
      perform pg_temp.ws_as(m);
      update public.knowledge_resources set deleted_at = now(), trashed_by = m where id = mixed;
      get diagnostics n = row_count; actual := n > 0;
      raise exception using errcode = 'P0001', message = 'undo';
    exception
      when sqlstate 'P0001' then null;
      when others then actual := false; detail := '(' || sqlstate || ')';
    end;
    reset role;
    raise notice '% | member / own folder holding the admin''s node / node.trash refused by the cascade | actual=% %',
      case when not actual then 'PASS' else '*** FAIL ***' end, actual, coalesce(detail, '');
  end;

  -- someone who is not a member of the space: nothing at all.
  select v::uuid into me from ws_ids where k = 'stranger';
  perform pg_temp.ws_as(me);
  scope := public.rpc_my_write_scope(v_s);
  reset role;
  raise notice '% | stranger gets none everywhere | scope=%',
    case when (select bool_and(value = to_jsonb('none'::text)) from jsonb_each(scope)) then 'PASS' else '*** FAIL ***' end,
    scope;
end
$probe$;

-- anon may not call it at all.
do $anon$
begin
  begin
    execute 'set local role anon';
    perform public.rpc_my_write_scope('spc_anything.0000000000');
    raise notice '*** FAIL *** | anon cannot call the snapshot | called';
  exception when insufficient_privilege then
    raise notice 'PASS | anon cannot call the snapshot | denied';
  end;
  reset role;
end
$anon$;

rollback;
