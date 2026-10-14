/*
 * Entity ids on the server: the published generator, plus validators.
 *
 * What these functions are
 * - public.entity_id_generate(prefix) mints "<prefix>_<rand16>.<ts10>": a
 *   lowercase prefix, 80 random bits and a millisecond timestamp, both in
 *   lowercase Crockford base32. Every id column default in this database
 *   calls it with its table's prefix.
 * - public.is_entity_id(value) and public.is_entity_id_with_prefix(value, prefix)
 *   say whether a text is such an id (of that kind).
 * - public.entity_id_ts_of(value) returns an id's time suffix; ordering by it
 *   is chronological, and it is immutable, so it can back an index.
 *
 * Why they are replaced and added
 * - One toolkit on both sides: these are the SQL counterpart of the `entity-id`
 *   package the application mints and checks ids with, taken verbatim from it,
 *   so an id minted in either place passes the other's checks.
 * - The generator now draws its randomness from the core gen_random_uuid()
 *   instead of pgcrypto's gen_random_bytes. Same signature, same output shape,
 *   same search_path; ids minted before stay valid.
 * - Ids also arrive as text from outside (RPC arguments, imports); the
 *   validators let a function or a CHECK refuse a malformed or wrong-kind id
 *   before it is used.
 *
 * Idempotent: every statement is `create or replace`. The four helper
 * functions are unchanged and restated only to keep this a faithful copy.
 */

create or replace function public.entity_id_crockford_alphabet()
returns text
language sql
security invoker
set search_path = ''
immutable
as $$
  select '0123456789abcdefghjkmnpqrstvwxyz'::text;
$$;

create or replace function public.entity_id_crockford_from_bits(bits bit varying)
returns text
language plpgsql
security invoker
set search_path = ''
immutable
as $$
declare
  alphabet text;
  out text := '';
  chunk bit(5);
  val int;
  i int;
  n int;
begin
  if bits is null then
    raise exception 'bits must not be null';
  end if;

  if (length(bits) % 5) <> 0 then
    raise exception 'bit length must be a multiple of 5 (got %)', length(bits);
  end if;

  alphabet := public.entity_id_crockford_alphabet();
  n := length(bits) / 5;

  for i in 0..(n - 1) loop
    chunk := substring(bits from (i * 5) + 1 for 5);
    val := chunk::int;
    out := out || substring(alphabet from val + 1 for 1);
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
  hex text;
  bits48 bit(48);
  bits50 bit(50);
begin
  if ms is null then
    raise exception 'ms must not be null';
  end if;
  if ms < 0 then
    raise exception 'ms must be non-negative';
  end if;

  -- 48 bits is enough for unix epoch milliseconds for thousands of years.
  -- represent ms as exactly 6 bytes (12 hex chars), big-endian.
  hex := lpad(to_hex(ms), 12, '0');
  bits48 := ('x' || hex)::bit(48);

  -- encode to 10 base32 chars (50 bits) by adding 2 leading zero bits.
  bits50 := b'00'::bit(2) || bits48;
  return public.entity_id_crockford_from_bits(bits50);
end;
$$;

create or replace function public.entity_id_encode_rand_16(bytes bytea)
returns text
language plpgsql
security invoker
set search_path = ''
immutable
as $$
declare
  bits80 bit(80);
begin
  if bytes is null then
    raise exception 'bytes must not be null';
  end if;
  if octet_length(bytes) <> 10 then
    raise exception 'rand bytes must be exactly 10 bytes (got %)', octet_length(bytes);
  end if;

  -- convert to a fixed 80-bit bitstring via hex.
  bits80 := ('x' || encode(bytes, 'hex'))::bit(80);
  return public.entity_id_crockford_from_bits(bits80);
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
  ts10 text;
  rand16 text;
begin
  p := lower(trim(prefix));
  if p is null or p = '' then
    raise exception 'prefix must not be empty';
  end if;
  if p !~ '^[a-z][a-z0-9]{1,15}$' then
    raise exception 'invalid prefix "%": expected [a-z][a-z0-9]{1,15}', prefix;
  end if;

  ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  ts10 := public.entity_id_encode_ts_10(ms);
  -- 10 random bytes, taken from the first 10 bytes of a v4 UUID's hex form.
  -- `gen_random_uuid()` is core since PostgreSQL 13, so no extension and no
  -- schema-qualification guesswork is needed.
  rand16 := public.entity_id_encode_rand_16(
    decode(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 20), 'hex')
  );

  return p || '_' || rand16 || '.' || ts10;
end;
$$;

comment on function public.entity_id_generate(text) is
  'Generates "<prefix>_<rand16>.<ts10>" entity ids using Crockford base32 (lowercase).';

/*
 * Validators — the DB-side analog of the package''s `isEntityId` /
 * `isEntityIdWithPrefix`. Use in a column CHECK so a wrong-format or
 * wrong-prefix id is rejected before it lands, mirroring parse-at-the-boundary
 * on the application side. The Crockford class matches the package regex
 * (mixed case accepted on the ULID segments; prefix stays lowercase).
 */
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

/*
 * Chronological ordering support.
 *
 * The randomness segment precedes the timestamp, so `order by id` is NOT
 * chronological. This function exposes the fixed-width time suffix, whose
 * lexicographic order IS chronological order — no decoding needed at query
 * time. It is `immutable`, so it can back an index:
 *
 *   create index events_ts_idx on events (public.entity_id_ts_of(id) desc);
 *   select * from events order by public.entity_id_ts_of(id) desc limit 50;
 *
 * The index is OPTIONAL. A dedicated `created_at` column is still the better
 * default — it is faster, smaller, and independent of the id format. Reach for
 * this when adding a column is not practical, on an existing table say.
 * Returns null for a value carrying no time suffix.
 */
create or replace function public.entity_id_ts_of(value text)
returns text
language sql
security invoker
set search_path = ''
immutable
strict
parallel safe
as $$
  select case
    when position('.' in value) = 0 then null
    else substring(value from position('.' in value) + 1)
  end;
$$;

comment on function public.entity_id_ts_of(text) is
  'The time suffix of an entity id; lexicographic order over it is chronological. Immutable, so it can back an index.';
