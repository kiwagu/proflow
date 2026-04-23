/*
 * public.entity ids: canonical generator for "<prefix>_<rand16>.<ts10>".
 *
 * purpose
 * - provide a single, database-native default id mechanism for new domain tables.
 * - match the canonical string contract used in `@workspace/entity-id`:
 *   - prefix: `[a-z][a-z0-9]{1,15}`
 *   - rand: 16 chars, crockford base32, lowercase (80 bits of randomness)
 *   - ts: 10 chars, crockford base32, lowercase (millisecond timestamp)
 *
 * notes
 * - ulid 1:1 compatibility is not required; ordering should use created_at for list apis.
 * - rand + ts are encoded using the crockford base32 alphabet (lowercase):
 *   "0123456789abcdefghjkmnpqrstvwxyz"
 *
 * how to use
 * - example column default:
 *   `id text primary key default public.entity_id_generate('usr')`
 */
 
create extension if not exists pgcrypto with schema extensions;
 
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
  rand16 := public.entity_id_encode_rand_16(extensions.gen_random_bytes(10));
 
  return p || '_' || rand16 || '.' || ts10;
end;
$$;
 
comment on function public.entity_id_generate(text) is
  'Generates "<prefix>_<rand16>.<ts10>" entity ids using crockford base32 (lowercase).';

