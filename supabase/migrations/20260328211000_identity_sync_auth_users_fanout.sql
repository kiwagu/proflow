/*
 * Single migration: Supabase Auth users -> Edge identity_lifecycle_fanout -> subscribers (e.g. Author).
 *
 * - AFTER INSERT: Studio / Admin API (GoTrue adminUserCreate does not fire HTTP hooks).
 * - AFTER DELETE: same internal ingest path.
 *
 * identity_sync.outbound_config.internal_secret starts NULL; `make db-push` runs db-sync-identity-secret
 * (Makefile DEV_IDENTITY_INTERNAL_INGEST_SECRET — must match docker-compose functions env).
 *
 * RLS policies on outbound_config: satisfy linter 0008 (RLS enabled must have policies); deny anon/authenticated.
 */

create extension if not exists pg_net with schema extensions;

create schema if not exists identity_sync;

create table if not exists identity_sync.outbound_config (
  id integer primary key check (id = 1),
  edge_fanout_url text not null default 'http://kong:8000/functions/v1/identity_lifecycle_fanout',
  internal_secret text
);

comment on table identity_sync.outbound_config is
  'Single-row config for auth.users insert/delete fan-out. Set internal_secret to IDENTITY_INTERNAL_INGEST_SECRET.';

alter table identity_sync.outbound_config enable row level security;

revoke all on schema identity_sync from public;
revoke all on table identity_sync.outbound_config from public;

grant usage on schema identity_sync to postgres;
grant select, insert, update, delete on table identity_sync.outbound_config to postgres;

create policy "outbound_config deny select for anon and authenticated"
  on identity_sync.outbound_config
  for select
  to anon, authenticated
  using (false);

create policy "outbound_config deny insert for anon and authenticated"
  on identity_sync.outbound_config
  for insert
  to anon, authenticated
  with check (false);

create policy "outbound_config deny update for anon and authenticated"
  on identity_sync.outbound_config
  for update
  to anon, authenticated
  using (false)
  with check (false);

create policy "outbound_config deny delete for anon and authenticated"
  on identity_sync.outbound_config
  for delete
  to anon, authenticated
  using (false);

insert into identity_sync.outbound_config (id, edge_fanout_url, internal_secret)
values (1, 'http://kong:8000/functions/v1/identity_lifecycle_fanout', null)
on conflict (id) do nothing;

create or replace function identity_sync.notify_auth_user_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg record;
  req_body jsonb;
  req_headers jsonb;
  entity_id text;
begin
  select c.edge_fanout_url, c.internal_secret
  into cfg
  from identity_sync.outbound_config as c
  where c.id = 1;

  if cfg is null or cfg.internal_secret is null or cfg.internal_secret = '' then
    raise warning
      'identity_sync: auth user delete fan-out skipped (set identity_sync.outbound_config.internal_secret = same value as IDENTITY_INTERNAL_INGEST_SECRET in functions env)';
    return old;
  end if;

  select p.entity_id
  into entity_id
  from public.profiles as p
  where p.user_id = old.id;

  req_body := jsonb_build_object(
    'event', 'user.deleted',
    'user', jsonb_build_object(
      'id', old.id::text,
      'email', old.email,
      'entity_id', entity_id
    )
  );

  req_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'X-Identity-Internal-Secret', cfg.internal_secret
  );

  perform net.http_post(
    cfg.edge_fanout_url,
    req_body,
    '{}'::jsonb,
    req_headers,
    8000
  );

  return old;
end;
$$;

comment on function identity_sync.notify_auth_user_deleted() is
  'BEFORE DELETE on auth.users: async HTTP POST to identity_lifecycle_fanout. Includes profiles.entity_id when present.';

alter function identity_sync.notify_auth_user_deleted() owner to postgres;

drop trigger if exists on_auth_user_deleted_identity_fanout on auth.users;
drop trigger if exists on_auth_user_deleted_identity_fanout_before on auth.users;

create trigger on_auth_user_deleted_identity_fanout_before
before delete on auth.users
for each row
execute function identity_sync.notify_auth_user_deleted();

create or replace function identity_sync.notify_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg record;
  req_body jsonb;
  req_headers jsonb;
begin
  select c.edge_fanout_url, c.internal_secret
  into cfg
  from identity_sync.outbound_config as c
  where c.id = 1;

  if cfg is null or cfg.internal_secret is null or cfg.internal_secret = '' then
    raise warning
      'identity_sync: auth user create fan-out skipped (set identity_sync.outbound_config.internal_secret = same value as IDENTITY_INTERNAL_INGEST_SECRET in functions env)';
    return new;
  end if;

  req_body := jsonb_build_object(
    'event', 'user.created',
    'user', jsonb_build_object(
      'id', new.id::text,
      'email', new.email,
      'app_metadata', coalesce(new.raw_app_meta_data, '{}'::jsonb),
      'user_metadata', coalesce(new.raw_user_meta_data, '{}'::jsonb)
    )
  );

  req_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'X-Identity-Internal-Secret', cfg.internal_secret
  );

  perform net.http_post(
    cfg.edge_fanout_url,
    req_body,
    '{}'::jsonb,
    req_headers,
    8000
  );

  return new;
end;
$$;

comment on function identity_sync.notify_auth_user_created() is
  'AFTER INSERT on auth.users: async HTTP POST to identity_lifecycle_fanout (user.created). Skips with WARNING if internal_secret unset. Covers Studio/Admin API creates (no GoTrue hook).';

alter function identity_sync.notify_auth_user_created() owner to postgres;

drop trigger if exists on_auth_user_created_identity_fanout on auth.users;

/*
 * user.created now publishes from public.profiles to guarantee entity_id exists.
 * we intentionally stop publishing user.created directly from auth.users.
 */

create or replace function identity_sync.notify_profile_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg record;
  req_body jsonb;
  req_headers jsonb;
  app_metadata jsonb;
  user_metadata jsonb;
begin
  select c.edge_fanout_url, c.internal_secret
  into cfg
  from identity_sync.outbound_config as c
  where c.id = 1;

  if cfg is null or cfg.internal_secret is null or cfg.internal_secret = '' then
    raise warning
      'identity_sync: profile create fan-out skipped (set identity_sync.outbound_config.internal_secret = same value as IDENTITY_INTERNAL_INGEST_SECRET in functions env)';
    return new;
  end if;

  select
    coalesce(u.raw_app_meta_data, '{}'::jsonb) as app_metadata,
    coalesce(u.raw_user_meta_data, '{}'::jsonb) as user_metadata
  into app_metadata, user_metadata
  from auth.users as u
  where u.id = new.user_id;

  req_body := jsonb_build_object(
    'event', 'user.created',
    'user', jsonb_build_object(
      'id', new.user_id::text,
      'entity_id', new.entity_id,
      'email', new.email,
      'app_metadata', coalesce(app_metadata, '{}'::jsonb),
      'user_metadata', coalesce(user_metadata, '{}'::jsonb)
    )
  );

  req_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'X-Identity-Internal-Secret', cfg.internal_secret
  );

  perform net.http_post(
    cfg.edge_fanout_url,
    req_body,
    '{}'::jsonb,
    req_headers,
    8000
  );

  return new;
end;
$$;

comment on function identity_sync.notify_profile_created() is
  'AFTER INSERT on public.profiles: async HTTP POST to identity_lifecycle_fanout (user.created) including entity_id.';

alter function identity_sync.notify_profile_created() owner to postgres;

drop trigger if exists on_profile_created_identity_fanout on public.profiles;
create trigger on_profile_created_identity_fanout
after insert on public.profiles
for each row
execute function identity_sync.notify_profile_created();
