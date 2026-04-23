/*
 * public.profiles: platform account row per auth user (RLS, auto-insert on auth.users).
 * Replaces former fragments:
 * - 20260326120000_create_profiles.sql
 * - 20260328203000_profiles_updated_at_align_not_null_default.sql
 *
 * Identity / Payload login sync lives in `20260328211000_identity_sync_auth_users_fanout.sql`.
 */

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  entity_id text not null default public.entity_id_generate('usr'),
  email text,
  display_name text,
  avatar_url text,
  bio text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'id'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'user_id'
  ) then
    alter table public.profiles rename column id to user_id;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'username'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'display_name'
  ) then
    update public.profiles
    set display_name = coalesce(display_name, username)
    where username is not null;
  end if;
end
$$;

alter table public.profiles
  alter column user_id set not null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_user_id_fkey'
  ) then
    alter table public.profiles drop constraint profiles_user_id_fkey;
  end if;
end
$$;

alter table public.profiles
  add constraint profiles_user_id_fkey
  foreign key (user_id)
  references auth.users (id)
  on delete cascade;

alter table public.profiles
  add column if not exists created_at timestamptz not null default timezone('utc', now());
alter table public.profiles
  add column if not exists updated_at timestamptz not null default timezone('utc', now());
alter table public.profiles
  add column if not exists entity_id text not null default public.entity_id_generate('usr');
alter table public.profiles
  add column if not exists email text;
alter table public.profiles
  add column if not exists display_name text;
alter table public.profiles
  add column if not exists avatar_url text;
alter table public.profiles
  add column if not exists bio text;

alter table public.profiles
  drop column if exists website;
alter table public.profiles
  drop column if exists username;

update public.profiles p
set email = u.email
from auth.users u
where p.user_id = u.id
  and (p.email is null or p.email = '');

-- backfill entity_id for pre-existing rows.
update public.profiles
set entity_id = coalesce(entity_id, public.entity_id_generate('usr'))
where entity_id is null or entity_id = '';

-- Align updated_at if a pre-existing column skipped stronger DDL via `add column if not exists`.
update public.profiles
set updated_at = coalesce(updated_at, created_at, timezone('utc', now()))
where updated_at is null;

alter table public.profiles
  alter column updated_at set default timezone('utc', now()),
  alter column updated_at set not null;

comment on table public.profiles is 'Application-level user profile data managed by the platform shell.';
comment on column public.profiles.user_id is 'References auth.users.id.';
comment on column public.profiles.entity_id is 'Canonical user entity id ("usr_<rand16>.<ts10>") shared across services.';
comment on column public.profiles.email is 'Optional profile contact email. Initialized from auth.users but editable.';
comment on column public.profiles.display_name is 'Display name shown in product UI.';
comment on column public.profiles.avatar_url is 'URL of the user avatar image.';
comment on column public.profiles.bio is 'Short profile description.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_entity_id_key'
  ) then
    alter table public.profiles
      add constraint profiles_entity_id_key unique (entity_id);
  end if;
end
$$;

-- Optional index for prefix searches like: `where entity_id like 'usr_%'`.
-- (PK on user_id and UNIQUE on entity_id already create btree indexes.)
create index if not exists profiles_entity_id_like_idx
on public.profiles (entity_id text_pattern_ops);

create or replace function public.set_profiles_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_profiles_updated_at();

create or replace function public.handle_new_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email)
  values (new.id, new.email)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_profile on auth.users;
create trigger on_auth_user_created_create_profile
after insert on auth.users
for each row
execute function public.handle_new_auth_user_profile();

alter table public.profiles enable row level security;

drop policy if exists "Public profiles are viewable by the owner." on public.profiles;
drop policy if exists "Users can insert their own profile." on public.profiles;
drop policy if exists "Users can update own profile." on public.profiles;
drop policy if exists "profiles select own row" on public.profiles;
drop policy if exists "profiles insert own row" on public.profiles;
drop policy if exists "profiles update own row" on public.profiles;
drop policy if exists "profiles delete own row" on public.profiles;

create policy "profiles select own row"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "profiles insert own row"
on public.profiles
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "profiles update own row"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "profiles delete own row"
on public.profiles
for delete
to authenticated
using ((select auth.uid()) = user_id);
