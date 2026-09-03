-- Entity ids, v1. The database-side half of the id contract every table in
-- this schema uses:
--
--   "<prefix>_<rand16>.<ts10>"
--     prefix — the kind of thing the id points at, [a-z][a-z0-9]{1,15}
--     rand   — 16 chars of Crockford base32 (80 bits of randomness)
--     ts     — 10 chars of Crockford base32 (millisecond timestamp)
--
-- Ids are minted by the application, not here: a command must know the id
-- before the write lands, or it cannot show its outcome until the database
-- answers. What this file is for is the other half — validating the shape in
-- a CHECK, so a wrong-kind id is refused at the boundary rather than found
-- later, and minting rows the application inserts in bulk by SQL alone.
--
-- Randomness comes from gen_random_uuid() (122 bits, core Postgres) rather
-- than pgcrypto's gen_random_bytes, which is a contrib module this build
-- does not load.
--
-- Ordering note: rand precedes ts, so the string is NOT time-sortable —
-- order by created_at, or decode the timestamp.

create or replace function public.entity_id_crockford_from_bits(bits bit varying)
returns text
language plpgsql
security invoker
set search_path = ''
immutable
as $$
declare
  alphabet text := '0123456789abcdefghjkmnpqrstvwxyz';
  out text := '';
  i int;
  n int;
begin
  if bits is null then
    raise exception 'bits must not be null';
  end if;
  if (length(bits) % 5) <> 0 then
    raise exception 'bit length must be a multiple of 5 (got %)', length(bits);
  end if;

  n := length(bits) / 5;
  for i in 0..(n - 1) loop
    out := out || substring(
      alphabet from (substring(bits from (i * 5) + 1 for 5))::bit(5)::int + 1 for 1
    );
  end loop;
  return out;
end;
$$;

create or replace function public.entity_id_encode_ts_10(ms bigint)
returns text
language plpgsql
security invoker
set search_path = ''
immutable
as $$
declare
  bits48 bit(48);
begin
  if ms is null or ms < 0 then
    raise exception 'ms must be a non-negative number of milliseconds';
  end if;
  -- 48 bits carries unix milliseconds for thousands of years; two leading
  -- zero bits pad it to the 50 bits that encode as exactly 10 characters.
  bits48 := ('x' || lpad(to_hex(ms), 12, '0'))::bit(48);
  return public.entity_id_crockford_from_bits(b'00'::bit(2) || bits48);
end;
$$;

create or replace function public.entity_id_generate(prefix text)
returns text
language plpgsql
security invoker
set search_path = ''
volatile
as $$
declare
  p text;
  ms bigint;
  bits80 bit(80);
begin
  p := lower(trim(prefix));
  if p is null or p = '' then
    raise exception 'prefix must not be empty';
  end if;
  if p !~ '^[a-z][a-z0-9]{1,15}$' then
    raise exception 'invalid prefix "%": expected [a-z][a-z0-9]{1,15}', prefix;
  end if;

  ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  -- 20 hex characters of a random uuid are 80 bits, the width of the
  -- randomness half of the id.
  bits80 := ('x' || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 20))::bit(80);

  return p
    || '_' || public.entity_id_crockford_from_bits(bits80)
    || '.' || public.entity_id_encode_ts_10(ms);
end;
$$;

comment on function public.entity_id_generate(text) is
  'Generates "<prefix>_<rand16>.<ts10>" entity ids using Crockford base32 (lowercase).';

create or replace function public.is_entity_id(value text)
returns boolean
language sql
security invoker
set search_path = ''
immutable
as $$
  select value is not null
    and value ~ '^[a-z][a-z0-9]{1,15}_[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{16}\.[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{10}$';
$$;

create or replace function public.is_entity_id_with_prefix(value text, prefix text)
returns boolean
language sql
security invoker
set search_path = ''
immutable
as $$
  select public.is_entity_id(value)
    and value like lower(trim(prefix)) || '\_%';
$$;

comment on function public.is_entity_id(text) is
  'True when the text matches the entity-id contract "<prefix>_<rand16>.<ts10>".';
comment on function public.is_entity_id_with_prefix(text, text) is
  'True when the text is an entity id carrying the given prefix.';
