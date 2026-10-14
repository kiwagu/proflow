-- Compatibility probe for the entity-id functions: the generator and the
-- validators in the database must agree with the application's id package.
--
-- WHAT THIS IS FOR
--   Ids are minted on both sides — by column defaults in the database and by
--   the application — and checked on both sides. This script checks the
--   database's half against the shared contract "<prefix>_<rand16>.<ts10>":
--     - ids the generator mints pass is_entity_id and is_entity_id_with_prefix
--       with their own prefix, and fail with another one;
--     - ids the PREVIOUS generator minted (literal samples from a dev
--       database) still pass the validators;
--     - ids the application package mints (literal samples at fixed times)
--       pass them, and entity_id_ts_of returns the time suffix that encodes
--       the timestamp the package decodes;
--     - malformed values are refused, and NULL is not an id;
--     - the key columns the clients replicate, and the writer of a document
--       update, carry CHECK constraints added NOT VALID: present, not yet
--       validated, and refusing a malformed or non-lowercase value on write.
--   The package side of the same samples is pinned by
--   packages/entity-id/src/sql-compat.test.ts.
--
-- HOW TO RUN (against a stand, never production)
--   docker exec -i <db-container> psql -U postgres -d postgres \
--     -f /dev/stdin < supabase/tests/entity_id_compat.sql
--
-- SAFETY
--   One transaction, ending in ROLLBACK; the trial writes run in their own
--   subtransactions and are undone whether they succeed or not.

begin;

create or replace function pg_temp.check(label text, ok boolean, detail text default '')
returns void
language plpgsql
as $$
begin
  raise notice '% | % %',
    case when ok then 'PASS' else '*** FAIL ***' end, label, coalesce(detail, '');
end;
$$;

do $probe$
declare
  v_id text;
  p text;
  sample record;
begin
  -- The generator, for a spread of registered prefixes.
  foreach p in array array['usr', 'org', 'spc', 'knr', 'kne', 'doc', 'wrt', 'kmb'] loop
    v_id := public.entity_id_generate(p);
    perform pg_temp.check('generated ' || p || '_ id is an entity id', public.is_entity_id(v_id), v_id);
    perform pg_temp.check('generated ' || p || '_ id carries its prefix', public.is_entity_id_with_prefix(v_id, p), v_id);
    perform pg_temp.check('generated ' || p || '_ id fails another prefix',
      not public.is_entity_id_with_prefix(v_id, case when p = 'usr' then 'spc' else 'usr' end), v_id);
    perform pg_temp.check('generated ' || p || '_ id is canonical lowercase', v_id = lower(v_id), v_id);
    perform pg_temp.check('generated ' || p || '_ id time suffix is now',
      public.entity_id_ts_of(v_id) between
        public.entity_id_encode_ts_10(floor(extract(epoch from clock_timestamp()) * 1000)::bigint - 60000)
        and public.entity_id_encode_ts_10(floor(extract(epoch from clock_timestamp()) * 1000)::bigint + 60000),
      public.entity_id_ts_of(v_id));
  end loop;

  perform pg_temp.check('the prefix argument is normalized',
    public.entity_id_generate('  SPC ') like 'spc\_%');

  -- Ids minted by the generator this migration replaced.
  for sample in
    select * from (values
      ('spc_ng7eccdk2074dsvk.01m2ara9cm', 'spc'),
      ('org_y57fe5d5v76fj3m8.01m2ara9ck', 'org'),
      ('knr_szkzqcp6a1ryxjf1.01m4v5xmza', 'knr'),
      ('kne_dses4y8d25svc7wg.01m4x37jqn', 'kne'),
      ('doc_j8dwbmkfzqz11rqp.01m4v5zm85', 'doc')
    ) as s(id, prefix)
  loop
    perform pg_temp.check('previous generator id passes: ' || sample.id,
      public.is_entity_id(sample.id) and public.is_entity_id_with_prefix(sample.id, sample.prefix));
  end loop;

  -- The same kinds as they sit in this database right now.
  for sample in
    select s.id, 'spc' as prefix from (select id from public.spaces limit 3) s
    union all select o.id, 'org' from (select id from public.organizations limit 2) o
    union all select k.id, 'knr' from (select id from public.knowledge_resources limit 2) k
    union all select e.id, 'kne' from (select id from public.knowledge_edges limit 2) e
    union all select d.id, 'doc' from (select id from public.crdt_documents limit 2) d
  loop
    perform pg_temp.check('stored id passes: ' || sample.id,
      public.is_entity_id(sample.id) and public.is_entity_id_with_prefix(sample.id, sample.prefix));
  end loop;

  -- Ids minted by the application package at fixed times.
  for sample in
    select * from (values
      ('spc_634t13df1xe89j6d.01k7g08h00', 'spc', 1760400000000::bigint),
      ('doc_mfwnxpatbzhbfrja.01k7h9ewkv', 'doc', 1760443200123::bigint),
      ('wrt_rzgdg9qzq677snqs.01hf7yat00', 'wrt', 1700000000000::bigint)
    ) as s(id, prefix, time_ms)
  loop
    perform pg_temp.check('package id passes: ' || sample.id,
      public.is_entity_id(sample.id) and public.is_entity_id_with_prefix(sample.id, sample.prefix));
    perform pg_temp.check('package id time suffix encodes its timestamp: ' || sample.id,
      public.entity_id_ts_of(sample.id) = public.entity_id_encode_ts_10(sample.time_ms),
      public.entity_id_ts_of(sample.id));
  end loop;

  -- Mixed case is accepted on the segments, as the package accepts it.
  perform pg_temp.check('mixed-case segments are accepted',
    public.is_entity_id('spc_634T13DF1XE89J6D.01K7G08H00'));

  -- Malformed values.
  foreach v_id in array array[
    'usr_'' OR 1=1--',
    'usr_' || repeat('a', 200),
    'usr_abc.def',
    'usr_aaaaaaaaaaaaaaaa.aaaaaaaaai',
    'USR_aaaaaaaaaaaaaaaa.aaaaaaaaaa',
    'usr_aaaaaaaaaaaaaaaa.aaaaaaaaaa ',
    'u_aaaaaaaaaaaaaaaa.aaaaaaaaaa',
    ''
  ] loop
    perform pg_temp.check('malformed is refused: ' || left(v_id, 40), not public.is_entity_id(v_id));
  end loop;
  perform pg_temp.check('a prefix that only starts the same is refused',
    not public.is_entity_id_with_prefix('spcx_634t13df1xe89j6d.01k7g08h00', 'spc'));
  perform pg_temp.check('NULL is not an id', not coalesce(public.is_entity_id(null), false));
  perform pg_temp.check('a value with no time suffix has none', public.entity_id_ts_of('usr_abc') is null);

  begin
    perform public.entity_id_generate('1bad');
    perform pg_temp.check('an invalid prefix is refused by the generator', false);
  exception when others then
    perform pg_temp.check('an invalid prefix is refused by the generator', true, sqlerrm);
  end;
end
$probe$;

-- The CHECKs on stored keys: present, NOT VALID, refusing malformed writes.
do $checks$
declare
  c record;
  found record;
  doc text;
  node record;
  edge record;
begin
  for c in
    select * from (values
      ('public', 'crdt_documents', 'id', 'doc'),
      ('public', 'crdt_updates', 'writer', 'wrt'),
      ('public', 'knowledge_resources', 'id', 'knr'),
      ('public', 'knowledge_resources', 'space_id', 'spc'),
      ('public', 'knowledge_edges', 'id', 'kne'),
      ('public', 'knowledge_edges', 'space_id', 'spc'),
      ('public', 'knowledge_edges', 'from_id', 'knr'),
      ('public', 'knowledge_edges', 'to_id', 'knr'),
      ('public', 'resource_user_state', 'id', 'rus'),
      ('public', 'resource_user_state', 'space_id', 'spc'),
      ('public', 'resource_user_state', 'resource_id', 'knr'),
      ('kb', 'resource_description', 'id', 'krd'),
      ('kb', 'resource_description', 'space_id', 'spc'),
      ('kb', 'resource_description', 'node_id', 'knr'),
      ('kb', 'resource_link', 'id', 'krl'),
      ('kb', 'resource_link', 'space_id', 'spc'),
      ('kb', 'resource_link', 'node_id', 'knr'),
      ('kb', 'media_blob', 'id', 'kmb'),
      ('kb', 'media_blob', 'space_id', 'spc'),
      ('kb', 'resource_media_meta', 'id', 'kmm'),
      ('kb', 'resource_media_meta', 'space_id', 'spc'),
      ('kb', 'resource_media_meta', 'node_id', 'knr'),
      ('kb', 'resource_media_meta', 'blob_id', 'kmb')
    ) as t(schema_name, table_name, column_name, prefix)
  loop
    select k.convalidated, pg_get_constraintdef(k.oid) as def into found
      from pg_constraint k
     where k.conrelid = format('%I.%I', c.schema_name, c.table_name)::regclass
       and k.conname = c.table_name || '_' || c.column_name || '_is_entity_id';
    perform pg_temp.check(
      format('%s.%s.%s carries a NOT VALID %s_ check', c.schema_name, c.table_name, c.column_name, c.prefix),
      found.def is not null
        and found.convalidated = false
        and found.def like '%' || quote_literal(c.prefix) || '%',
      coalesce(found.def, 'missing'));
  end loop;

  -- A writer that is not a writer id is refused on insert.
  select id into doc from public.crdt_documents limit 1;
  if doc is null then
    perform pg_temp.check('a document to try writes on exists', false);
  else
    begin
      insert into public.crdt_updates (doc_id, bytes, writer, created_by)
      select doc, '\x00'::bytea, 'tab-1', d.created_by
        from public.crdt_documents d where d.id = doc;
      perform pg_temp.check('a malformed writer is refused on insert', false, 'inserted');
    exception when check_violation then
      perform pg_temp.check('a malformed writer is refused on insert', true, sqlerrm);
    end;
    begin
      insert into public.crdt_updates (doc_id, bytes, writer, created_by)
      select doc, '\x00'::bytea, public.entity_id_generate('wrt'), d.created_by
        from public.crdt_documents d where d.id = doc;
      raise exception 'undo' using errcode = 'P0002';
    exception
      when sqlstate 'P0002' then
        perform pg_temp.check('a well-formed writer is still taken', true);
      when others then
        perform pg_temp.check('a well-formed writer is still taken', false, sqlerrm);
    end;
  end if;

  -- A node or an edge whose key is malformed, or not in lowercase, is refused.
  select * into node from public.knowledge_resources limit 1;
  if node.id is not null then
    -- the second keeps the prefix lowercase: only the lowercase rule refuses it
    foreach doc in array array['knr_not-an-id', 'knr_' || upper(substr(public.entity_id_generate('knr'), 5))] loop
      begin
        insert into public.knowledge_resources
          (id, space_id, kind, title, created_by, owner_user_id, visibility)
        values (doc, node.space_id, node.kind, 'probe', node.created_by, node.owner_user_id, node.visibility);
        perform pg_temp.check('a malformed node id is refused: ' || doc, false, 'inserted');
      exception when check_violation then
        perform pg_temp.check('a malformed node id is refused: ' || doc, true, sqlerrm);
      end;
    end loop;
  end if;
  select * into edge from public.knowledge_edges limit 1;
  if edge.id is not null then
    begin
      insert into public.knowledge_edges (id, space_id, from_id, to_id, relation_type, created_by)
      values ('kne_not-an-id', edge.space_id, edge.from_id, edge.to_id, 'relates_to', edge.created_by);
      perform pg_temp.check('a malformed edge id is refused', false, 'inserted');
    exception when check_violation then
      perform pg_temp.check('a malformed edge id is refused', true, sqlerrm);
    end;
  end if;
end
$checks$;

rollback;
