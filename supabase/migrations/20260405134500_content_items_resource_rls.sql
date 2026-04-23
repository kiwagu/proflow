/*
 * section 4 unified model: first space-scoped resource slice
 * - seeds content admin/author roles and the space.content.* permission namespace
 * - adds the shared auth_user_can_access_in_space() helper for resource-table rls
 * - adds content_items as a reference resource table for section 4 enforcement
 */

-- ---------------------------------------------------------------------------
-- space content roles and permissions
-- ---------------------------------------------------------------------------

insert into public.roles (
  key,
  scope,
  role_kind,
  owner_organization_id,
  label,
  description,
  is_baseline,
  is_mutable
)
values
  ('admin',  'space', 'system', null, 'Admin',  'Content administrator - manages content and content access rules within a space.', false, true),
  ('author', 'space', 'system', null, 'Author', 'Content creator - creates and edits own content; cannot publish or delete.', false, true)
on conflict do nothing;

insert into public.permissions (key, description)
values
  ('space.content.create',  'Create content items in one space.'),
  ('space.content.read',    'Read content items in one space.'),
  ('space.content.update',  'Update content items in one space.'),
  ('space.content.delete',  'Delete content items in one space.'),
  ('space.content.publish', 'Publish content items in one space without moderation.'),
  ('space.content.access',  'Manage content access rules and grants in one space.')
on conflict (key) do nothing;

with mapping(role_key, permission_key) as (
  values
    ('admin', 'space.content.create'),
    ('admin', 'space.content.read'),
    ('admin', 'space.content.update'),
    ('admin', 'space.content.delete'),
    ('admin', 'space.content.publish'),
    ('admin', 'space.content.access'),
    ('admin', 'space.users.read'),
    ('admin', 'space.members.read'),
    ('author', 'space.content.create'),
    ('author', 'space.content.read'),
    ('author', 'space.content.update'),
    ('author', 'space.users.read')
)
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from mapping m
join public.roles r
  on r.key = m.role_key
 and r.role_kind = 'system'
 and r.owner_organization_id is null
 and r.archived_at is null
join public.permissions p on p.key = m.permission_key
on conflict (role_id, permission_id) do nothing;

-- ---------------------------------------------------------------------------
-- shared resource access helper
-- ---------------------------------------------------------------------------

create or replace function public.auth_user_can_access_in_space(
  p_space_id text,
  p_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.auth_user_active_in_space(p_space_id, (select auth.uid()))
    and public.auth_user_has_permission(
      p_permission_key,
      p_space_id,
      null::text
    );
$$;

comment on function public.auth_user_can_access_in_space(text, text) is
  'Checks active space membership plus scoped permission for the current authenticated user.';

revoke all on function public.auth_user_can_access_in_space(text, text) from public;
grant execute on function public.auth_user_can_access_in_space(text, text) to authenticated;

create table public.content_items (
  id text primary key default public.entity_id_generate('cnt'),
  space_id text not null references public.spaces (id) on delete cascade,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived', 'deleted')),
  visibility text not null default 'private' check (visibility in ('private', 'space', 'organization')),
  created_by uuid not null,
  owner_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.content_items is
  'Reference space-scoped resource table used to validate section 4 resource access and RLS patterns.';

create index content_items_space_id_status_idx
  on public.content_items (space_id, status);

create index content_items_space_id_visibility_idx
  on public.content_items (space_id, visibility);

create table public.scopes (
  id text primary key default public.entity_id_generate('scp'),
  space_id text not null references public.spaces (id) on delete cascade,
  key text not null,
  name text not null,
  created_by uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (space_id, key)
);

comment on table public.scopes is
  'Space-scoped grouping layer for section 4: links members and resources inside one space.';

create index scopes_space_id_key_idx
  on public.scopes (space_id, key);

create table public.scope_memberships (
  scope_id text not null references public.scopes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_by uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (scope_id, user_id)
);

comment on table public.scope_memberships is
  'Join table: users assigned to scopes in a space.';

create index scope_memberships_user_scope_idx
  on public.scope_memberships (user_id, scope_id);

create table public.content_item_scopes (
  content_item_id text not null references public.content_items (id) on delete cascade,
  scope_id text not null references public.scopes (id) on delete cascade,
  linked_by uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (content_item_id, scope_id)
);

comment on table public.content_item_scopes is
  'Join table: content resources linked to scopes inside one space.';

create index content_item_scopes_scope_content_idx
  on public.content_item_scopes (scope_id, content_item_id);

create or replace function public.set_content_items_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create trigger content_items_set_updated_at
before update on public.content_items
for each row
execute function public.set_content_items_updated_at();

create or replace function public.set_scopes_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create trigger scopes_set_updated_at
before update on public.scopes
for each row
execute function public.set_scopes_updated_at();

create or replace function public.assert_content_item_scope_same_space()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_content_space_id text;
  v_scope_space_id text;
begin
  select c.space_id into v_content_space_id
  from public.content_items c
  where c.id = new.content_item_id;

  select s.space_id into v_scope_space_id
  from public.scopes s
  where s.id = new.scope_id;

  if v_content_space_id is null or v_scope_space_id is null then
    raise exception 'content_item_scopes references unknown content_item or scope';
  end if;

  if v_content_space_id <> v_scope_space_id then
    raise exception 'content_item_scopes must link rows from the same space';
  end if;

  return new;
end;
$$;

create trigger content_item_scopes_same_space_guard
before insert or update on public.content_item_scopes
for each row
execute function public.assert_content_item_scope_same_space();

alter table public.content_items enable row level security;
alter table public.scopes enable row level security;
alter table public.scope_memberships enable row level security;
alter table public.content_item_scopes enable row level security;

revoke all on public.content_items from public;
revoke all on public.scopes from public;
revoke all on public.scope_memberships from public;
revoke all on public.content_item_scopes from public;

grant select, insert, update, delete on public.content_items to authenticated;
grant select, insert, update, delete on public.scopes to authenticated;
grant select, insert, update, delete on public.scope_memberships to authenticated;
grant select, insert, update, delete on public.content_item_scopes to authenticated;

create policy "content_items select for scoped readers"
on public.content_items
for select
to authenticated
using (
  public.auth_user_can_access_in_space(
    content_items.space_id,
    'space.content.read'
  )
);

create policy "content_items insert for scoped creators"
on public.content_items
for insert
to authenticated
with check (
  content_items.created_by = (select auth.uid())
  and public.auth_user_can_access_in_space(
    content_items.space_id,
    'space.content.create'
  )
);

create policy "content_items update for scoped editors"
on public.content_items
for update
to authenticated
using (
  public.auth_user_can_access_in_space(
    content_items.space_id,
    'space.content.update'
  )
)
with check (
  public.auth_user_can_access_in_space(
    content_items.space_id,
    'space.content.update'
  )
);

create policy "content_items delete for scoped deleters"
on public.content_items
for delete
to authenticated
using (
  public.auth_user_can_access_in_space(
    content_items.space_id,
    'space.content.delete'
  )
);

create policy "scopes select for scoped readers"
on public.scopes
for select
to authenticated
using (
  public.auth_user_can_access_in_space(
    scopes.space_id,
    'space.content.read'
  )
);

create policy "scopes insert for scoped access managers"
on public.scopes
for insert
to authenticated
with check (
  scopes.created_by = (select auth.uid())
  and public.auth_user_can_access_in_space(
    scopes.space_id,
    'space.content.access'
  )
);

create policy "scopes update for scoped access managers"
on public.scopes
for update
to authenticated
using (
  public.auth_user_can_access_in_space(
    scopes.space_id,
    'space.content.access'
  )
)
with check (
  public.auth_user_can_access_in_space(
    scopes.space_id,
    'space.content.access'
  )
);

create policy "scopes delete for scoped access managers"
on public.scopes
for delete
to authenticated
using (
  public.auth_user_can_access_in_space(
    scopes.space_id,
    'space.content.access'
  )
);

create policy "scope_memberships select for scoped readers"
on public.scope_memberships
for select
to authenticated
using (
  exists (
    select 1
    from public.scopes s
    where s.id = scope_memberships.scope_id
      and public.auth_user_can_access_in_space(
        s.space_id,
        'space.content.read'
      )
  )
);

create policy "scope_memberships insert for scoped access managers"
on public.scope_memberships
for insert
to authenticated
with check (
  exists (
    select 1
    from public.scopes s
    where s.id = scope_memberships.scope_id
      and public.auth_user_can_access_in_space(
        s.space_id,
        'space.content.access'
      )
  )
);

create policy "scope_memberships update for scoped access managers"
on public.scope_memberships
for update
to authenticated
using (
  exists (
    select 1
    from public.scopes s
    where s.id = scope_memberships.scope_id
      and public.auth_user_can_access_in_space(
        s.space_id,
        'space.content.access'
      )
  )
)
with check (
  exists (
    select 1
    from public.scopes s
    where s.id = scope_memberships.scope_id
      and public.auth_user_can_access_in_space(
        s.space_id,
        'space.content.access'
      )
  )
);

create policy "scope_memberships delete for scoped access managers"
on public.scope_memberships
for delete
to authenticated
using (
  exists (
    select 1
    from public.scopes s
    where s.id = scope_memberships.scope_id
      and public.auth_user_can_access_in_space(
        s.space_id,
        'space.content.access'
      )
  )
);

create policy "content_item_scopes select for scoped readers"
on public.content_item_scopes
for select
to authenticated
using (
  exists (
    select 1
    from public.content_items c
    where c.id = content_item_scopes.content_item_id
      and public.auth_user_can_access_in_space(
        c.space_id,
        'space.content.read'
      )
  )
);

create policy "content_item_scopes insert for scoped access managers"
on public.content_item_scopes
for insert
to authenticated
with check (
  exists (
    select 1
    from public.content_items c
    where c.id = content_item_scopes.content_item_id
      and public.auth_user_can_access_in_space(
        c.space_id,
        'space.content.access'
      )
  )
);

create policy "content_item_scopes update for scoped access managers"
on public.content_item_scopes
for update
to authenticated
using (
  exists (
    select 1
    from public.content_items c
    where c.id = content_item_scopes.content_item_id
      and public.auth_user_can_access_in_space(
        c.space_id,
        'space.content.access'
      )
  )
)
with check (
  exists (
    select 1
    from public.content_items c
    where c.id = content_item_scopes.content_item_id
      and public.auth_user_can_access_in_space(
        c.space_id,
        'space.content.access'
      )
  )
);

create policy "content_item_scopes delete for scoped access managers"
on public.content_item_scopes
for delete
to authenticated
using (
  exists (
    select 1
    from public.content_items c
    where c.id = content_item_scopes.content_item_id
      and public.auth_user_can_access_in_space(
        c.space_id,
        'space.content.access'
      )
  )
);