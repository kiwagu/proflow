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
--     - malformed values are refused, and NULL is not an id.
--   The package side of the same samples is pinned by
--   packages/entity-id/src/sql-compat.test.ts.
--
-- HOW TO RUN (against a stand, never production)
--   docker exec -i <db-container> psql -U postgres -d postgres \
--     -f /dev/stdin < supabase/tests/entity_id_compat.sql
--
-- SAFETY
--   Read-only: it calls functions and writes nothing, inside one transaction
--   that ends in ROLLBACK.

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

rollback;
