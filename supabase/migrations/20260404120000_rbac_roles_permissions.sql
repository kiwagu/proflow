/*
 * rbac core migration (greenfield reset mode)
 *
 * purpose:
 * - introduce normalized rbac tables: roles, permissions, role_permission, user_role
 * - remove legacy role columns from membership tables
 * - move invite role assignment to role_id
 * - keep existing space/org isolation model intact
 *
 * special consideration:
 * - this repo runs in reset mode for this phase, so no legacy data backfill is performed.
 */

-- ---------------------------------------------------------------------------
-- rbac core tables
-- ---------------------------------------------------------------------------

create table if not exists public.roles (
  id text primary key default public.entity_id_generate('rol'),
  key text not null,
  scope text not null check (scope in ('space', 'organization', 'global')),
  role_kind text not null check (role_kind in ('system', 'custom')),
  owner_organization_id text references public.organizations (id) on delete cascade,
  label text not null,
  description text,
  is_baseline boolean not null default false,
  is_mutable boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (
    (role_kind = 'system' and owner_organization_id is null)
    or (role_kind = 'custom' and owner_organization_id is not null)
  ),
  check (is_baseline = false or role_kind = 'system'),
  check (is_baseline = false or is_mutable = false),
  check (
    role_kind <> 'custom'
    or key not in ('member', 'space_admin', 'org_admin')
  )
);

create unique index if not exists roles_system_key_unique_idx
  on public.roles (key)
  where role_kind = 'system';

create unique index if not exists roles_custom_org_key_active_unique_idx
  on public.roles (owner_organization_id, key)
  where role_kind = 'custom' and archived_at is null;

create index if not exists roles_owner_org_idx
  on public.roles (owner_organization_id)
  where owner_organization_id is not null;

create index if not exists roles_scope_kind_active_idx
  on public.roles (scope, role_kind)
  where archived_at is null;

create table if not exists public.permissions (
  id text primary key default public.entity_id_generate('prm'),
  key text not null unique,
  description text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.role_permission (
  role_id text not null references public.roles (id) on delete cascade,
  permission_id text not null references public.permissions (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (role_id, permission_id)
);

create table if not exists public.user_role (
  id text primary key default public.entity_id_generate('url'),
  user_id uuid not null references auth.users (id) on delete cascade,
  role_id text not null references public.roles (id) on delete cascade,
  organization_id text references public.organizations (id) on delete cascade,
  space_id text references public.spaces (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  check (
    (
      space_id is not null
      and organization_id is null
    )
    or (
      organization_id is not null
      and space_id is null
    )
    or (
      organization_id is null
      and space_id is null
    )
  )
);

create unique index if not exists user_role_unique_space_idx
  on public.user_role (user_id, role_id, space_id)
  where space_id is not null and organization_id is null;

create unique index if not exists user_role_unique_org_idx
  on public.user_role (user_id, role_id, organization_id)
  where organization_id is not null and space_id is null;

create unique index if not exists user_role_unique_global_idx
  on public.user_role (user_id, role_id)
  where organization_id is null and space_id is null;

create index if not exists user_role_user_space_idx
  on public.user_role (user_id, space_id)
  where space_id is not null;

create index if not exists user_role_user_org_idx
  on public.user_role (user_id, organization_id)
  where organization_id is not null;

create index if not exists role_permission_role_idx on public.role_permission (role_id);

create or replace function public.roles_enforce_mutation_guards()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_baseline then
      raise exception 'Baseline system roles are immutable';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.is_baseline then
    raise exception 'Baseline system roles are immutable';
  end if;

  new.key := lower(trim(new.key));
  new.label := trim(new.label);

  if new.key = '' then
    raise exception 'roles.key is required';
  end if;

  if new.label = '' then
    raise exception 'roles.label is required';
  end if;

  if new.role_kind = 'system' then
    new.owner_organization_id := null;
  end if;

  if new.is_baseline then
    new.is_mutable := false;
  end if;

  return new;
end;
$$;

drop trigger if exists roles_enforce_mutation_guards on public.roles;
create trigger roles_enforce_mutation_guards
before insert or update or delete on public.roles
for each row
execute function public.roles_enforce_mutation_guards();

-- ---------------------------------------------------------------------------
-- updated_at trigger helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_roles_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists roles_set_updated_at on public.roles;
create trigger roles_set_updated_at
before update on public.roles
for each row
execute function public.set_roles_updated_at();

create or replace function public.set_permissions_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists permissions_set_updated_at on public.permissions;
create trigger permissions_set_updated_at
before update on public.permissions
for each row
execute function public.set_permissions_updated_at();

-- ---------------------------------------------------------------------------
-- seed roles + permissions + mappings
-- ---------------------------------------------------------------------------

with seed_roles(
  key,
  scope,
  label,
  description,
  is_baseline,
  is_mutable
) as (
  values
    ('member', 'space', 'Member', 'Default space member role.', true, false),
    ('space_admin', 'space', 'Space admin', 'Space-level administrative role.', true, false),
    ('org_admin', 'organization', 'Organization admin', 'Organization-level administrative role.', true, false),
    ('student', 'space', 'Student', 'Example domain role.', false, true),
    ('tutor', 'space', 'Tutor', 'Example domain role.', false, true),
    ('manager', 'space', 'Manager', 'Example domain role.', false, true)
)
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
select
  s.key,
  s.scope,
  'system',
  null,
  s.label,
  s.description,
  s.is_baseline,
  s.is_mutable
from seed_roles s
where not exists (
  select 1
  from public.roles r
  where r.key = s.key
    and r.role_kind = 'system'
);

insert into public.permissions (key, description)
values
  ('space.invites.manage', 'Manage invites inside one space.'),
  ('space.members.read', 'Read members of one space.'),
  ('space.members.write', 'Change membership status inside one space.'),
  ('space.users.create', 'Create domain user records in one space.'),
  ('space.users.read', 'Read domain user records in one space.'),
  ('space.users.update', 'Update domain user records in one space.'),
  ('space.users.delete', 'Delete domain user records in one space.'),
  ('org.spaces.create', 'Create spaces in one organization.'),
  ('org.spaces.delete', 'Delete spaces in one organization.'),
  ('org.members.read', 'Read organization-level membership data.'),
  ('org.members.write', 'Write organization-level membership data.')
on conflict (key) do nothing;

with mapping(role_key, permission_key) as (
  values
    ('member', 'space.members.read'),
    ('member', 'space.users.read'),
    ('space_admin', 'space.invites.manage'),
    ('space_admin', 'space.members.read'),
    ('space_admin', 'space.members.write'),
    ('space_admin', 'space.users.create'),
    ('space_admin', 'space.users.read'),
    ('space_admin', 'space.users.update'),
    ('space_admin', 'space.users.delete'),
    ('org_admin', 'space.invites.manage'),
    ('org_admin', 'space.members.read'),
    ('org_admin', 'space.members.write'),
    ('org_admin', 'space.users.create'),
    ('org_admin', 'space.users.read'),
    ('org_admin', 'space.users.update'),
    ('org_admin', 'space.users.delete'),
    ('org_admin', 'org.spaces.create'),
    ('org_admin', 'org.spaces.delete'),
    ('org_admin', 'org.members.read'),
    ('org_admin', 'org.members.write'),
    ('student', 'space.users.read'),
    ('tutor', 'space.users.read'),
    ('manager', 'space.users.read')
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
-- helper functions rewritten to rbac tables
-- ---------------------------------------------------------------------------

create or replace function public.auth_user_is_org_admin(
  p_organization_id text,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_role ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = p_user_id
      and ur.organization_id = p_organization_id
      and ur.space_id is null
      and r.key = 'org_admin'
      and r.role_kind = 'system'
      and r.owner_organization_id is null
      and r.archived_at is null
  );
$$;

create or replace function public.auth_user_is_space_admin(
  p_space_id text,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_role ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = p_user_id
      and ur.space_id = p_space_id
      and ur.organization_id is null
      and r.key = 'space_admin'
      and r.role_kind = 'system'
      and r.owner_organization_id is null
      and r.archived_at is null
  );
$$;

create or replace function public.auth_user_has_permission(
  p_permission_key text,
  p_space_id text default null,
  p_organization_id text default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with auth_ctx as (
    select auth.uid() as uid
  ),
  derived_org as (
    select
      case
        when p_organization_id is not null then p_organization_id
        when p_space_id is not null then (
          select s.organization_id
          from public.spaces s
          where s.id = p_space_id
        )
        else null
      end as organization_id
  )
  select exists (
    select 1
    from auth_ctx cu
    join public.user_role ur on ur.user_id = cu.uid
    join public.roles r on r.id = ur.role_id
    join public.role_permission rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    cross join derived_org d
    where p.key = p_permission_key
      and r.archived_at is null
      and (
        (p_space_id is not null and ur.space_id = p_space_id)
        or (
          d.organization_id is not null
          and ur.organization_id = d.organization_id
          and ur.space_id is null
        )
        or (
          ur.organization_id is null
          and ur.space_id is null
        )
      )
  );
$$;

comment on function public.auth_user_has_permission(text, text, text) is
  'Checks permission union for the current authenticated user in space/org scope.';

revoke all on function public.auth_user_has_permission(text, text, text) from public;
grant execute on function public.auth_user_has_permission(text, text, text) to authenticated;

revoke all on function public.auth_user_is_org_admin(text, uuid) from public;
grant execute on function public.auth_user_is_org_admin(text, uuid) to authenticated;

revoke all on function public.auth_user_is_space_admin(text, uuid) from public;
grant execute on function public.auth_user_is_space_admin(text, uuid) to authenticated;

create or replace function public.role_assignment_is_valid(
  p_role_id text,
  p_space_id text,
  p_organization_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with role_row as (
    select r.id, r.scope, r.role_kind, r.owner_organization_id, r.archived_at
    from public.roles r
    where r.id = p_role_id
  ),
  space_row as (
    select s.organization_id
    from public.spaces s
    where s.id = p_space_id
  )
  select case
    when not exists (select 1 from role_row) then false
    when p_space_id is not null and p_organization_id is null then
      exists (
        select 1
        from role_row rr
        cross join space_row sr
        where rr.scope = 'space'
          and rr.archived_at is null
          and (
            rr.owner_organization_id is null
            or rr.owner_organization_id = sr.organization_id
          )
      )
    when p_organization_id is not null and p_space_id is null then
      exists (
        select 1
        from role_row rr
        where rr.scope = 'organization'
          and rr.archived_at is null
          and (
            rr.owner_organization_id is null
            or rr.owner_organization_id = p_organization_id
          )
      )
    when p_organization_id is null and p_space_id is null then
      exists (
        select 1
        from role_row rr
        where rr.scope = 'global'
          and rr.role_kind = 'system'
          and rr.owner_organization_id is null
          and rr.archived_at is null
      )
    else false
  end;
$$;

revoke all on function public.role_assignment_is_valid(text, text, text) from public;
grant execute on function public.role_assignment_is_valid(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- remove legacy role columns
-- ---------------------------------------------------------------------------

drop policy if exists "organizations update for org_admin" on public.organizations;
drop policy if exists "space_memberships insert for org_admin or super_admin" on public.space_memberships;
drop policy if exists "space_memberships update for org_admin or super_admin" on public.space_memberships;
drop policy if exists "space_memberships delete for org_admin or super_admin" on public.space_memberships;

alter table public.organization_memberships
  drop constraint if exists organization_memberships_role_check;

alter table public.space_memberships
  drop constraint if exists space_memberships_role_check;

alter table public.organization_memberships
  drop column if exists role;

alter table public.space_memberships
  drop column if exists role;

-- ---------------------------------------------------------------------------
-- rebuild space_invites for role_id-based assignment
-- ---------------------------------------------------------------------------

drop table if exists public.space_invites cascade;

create table public.space_invites (
  id text primary key default public.entity_id_generate('spi'),
  space_id text not null references public.spaces (id) on delete cascade,
  email text not null,
  role_id text not null references public.roles (id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  token text not null,
  expires_at timestamptz not null,
  created_by_user_id uuid not null,
  accepted_by_user_id uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index space_invites_token_uniq on public.space_invites (token);
create unique index space_invites_space_email_pending_uniq
  on public.space_invites (space_id, email)
  where status = 'pending';
create index space_invites_space_id_idx on public.space_invites (space_id);
create index space_invites_status_idx on public.space_invites (status);

create or replace function public.space_invites_normalize_row()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.email := lower(trim(new.email));
  new.token := trim(new.token);
  if new.email = '' then
    raise exception 'space_invites: email is required';
  end if;
  if new.token = '' then
    raise exception 'space_invites: token is required';
  end if;
  return new;
end;
$$;

create trigger space_invites_normalize_before_iu
before insert or update on public.space_invites
for each row
execute function public.space_invites_normalize_row();

create or replace function public.set_space_invites_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create trigger space_invites_set_updated_at
before update on public.space_invites
for each row
execute function public.set_space_invites_updated_at();

create or replace function public.auth_user_can_manage_space_invites(
  p_space_id text,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(
      (
        select pr.is_super_admin
        from public.profiles pr
        where pr.user_id = p_user_id
      ),
      false
    ) = true
    or exists (
      select 1
      from public.spaces s
      where s.id = p_space_id
        and public.auth_user_is_org_admin(s.organization_id, p_user_id)
    )
    or public.auth_user_is_space_admin(p_space_id, p_user_id);
$$;

revoke all on function public.auth_user_can_manage_space_invites(text, uuid) from public;
grant execute on function public.auth_user_can_manage_space_invites(text, uuid) to authenticated;

alter table public.space_invites enable row level security;
revoke all on public.space_invites from public;
grant select on public.space_invites to authenticated;

create policy "space_invites select for invitee by jwt email"
on public.space_invites
for select
to authenticated
using (
  space_invites.email = lower(trim(coalesce((select auth.jwt()->>'email'), '')))
);

create policy "space_invites select for space invite managers"
on public.space_invites
for select
to authenticated
using (
  public.auth_user_can_manage_space_invites(space_invites.space_id, (select auth.uid()))
);

-- ---------------------------------------------------------------------------
-- rls for new rbac tables
-- ---------------------------------------------------------------------------

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permission enable row level security;
alter table public.user_role enable row level security;

revoke all on public.roles from public;
revoke all on public.permissions from public;
revoke all on public.role_permission from public;
revoke all on public.user_role from public;

grant select on public.roles to authenticated;
grant select on public.permissions to authenticated;
grant select on public.role_permission to authenticated;
grant select on public.user_role to authenticated;

create policy "roles select for authenticated"
on public.roles
for select
to authenticated
using (true);

create policy "roles insert for org_admin or super_admin"
on public.roles
for insert
to authenticated
with check (
  (
    coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
    and roles.role_kind = 'system'
    and roles.is_baseline = false
  )
  or (
    roles.role_kind = 'custom'
    and roles.owner_organization_id is not null
    and public.auth_user_is_org_admin(roles.owner_organization_id, (select auth.uid()))
  )
);

create policy "roles update for org_admin or super_admin"
on public.roles
for update
to authenticated
using (
  (
    coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
    and roles.role_kind = 'system'
    and roles.is_baseline = false
  )
  or (
    roles.role_kind = 'custom'
    and roles.owner_organization_id is not null
    and public.auth_user_is_org_admin(roles.owner_organization_id, (select auth.uid()))
  )
)
with check (
  (
    coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
    and roles.role_kind = 'system'
    and roles.is_baseline = false
  )
  or (
    roles.role_kind = 'custom'
    and roles.owner_organization_id is not null
    and public.auth_user_is_org_admin(roles.owner_organization_id, (select auth.uid()))
  )
);

create policy "roles delete for org_admin or super_admin"
on public.roles
for delete
to authenticated
using (
  (
    coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
    and roles.role_kind = 'system'
    and roles.is_baseline = false
  )
  or (
    roles.role_kind = 'custom'
    and roles.owner_organization_id is not null
    and public.auth_user_is_org_admin(roles.owner_organization_id, (select auth.uid()))
  )
);

create policy "permissions select for authenticated"
on public.permissions
for select
to authenticated
using (true);

create policy "role_permission select for authenticated"
on public.role_permission
for select
to authenticated
using (true);

create policy "role_permission insert for org_admin or super_admin"
on public.role_permission
for insert
to authenticated
with check (
  exists (
    select 1
    from public.roles r
    where r.id = role_permission.role_id
      and r.archived_at is null
      and (
        (
          coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
          and r.role_kind = 'system'
          and r.owner_organization_id is null
          and r.is_baseline = false
        )
        or (
          r.role_kind = 'custom'
          and r.owner_organization_id is not null
          and public.auth_user_is_org_admin(r.owner_organization_id, (select auth.uid()))
        )
      )
  )
);

create policy "role_permission delete for org_admin or super_admin"
on public.role_permission
for delete
to authenticated
using (
  exists (
    select 1
    from public.roles r
    where r.id = role_permission.role_id
      and r.archived_at is null
      and (
        (
          coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
          and r.role_kind = 'system'
          and r.owner_organization_id is null
          and r.is_baseline = false
        )
        or (
          r.role_kind = 'custom'
          and r.owner_organization_id is not null
          and public.auth_user_is_org_admin(r.owner_organization_id, (select auth.uid()))
        )
      )
  )
);

create policy "user_role select for self or super_admin"
on public.user_role
for select
to authenticated
using (
  user_role.user_id = (select auth.uid())
  or coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
  or (
    user_role.space_id is not null
    and public.auth_user_active_in_space(user_role.space_id, (select auth.uid()))
  )
);

create policy "user_role insert for org_admin or super_admin"
on public.user_role
for insert
to authenticated
with check (
  public.role_assignment_is_valid(
    user_role.role_id,
    user_role.space_id,
    user_role.organization_id
  )
  and (
  coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
  or (
    user_role.space_id is not null
    and exists (
      select 1
      from public.spaces s
      where s.id = user_role.space_id
        and public.auth_user_is_org_admin(s.organization_id, (select auth.uid()))
    )
  )
  or (
    user_role.organization_id is not null
    and public.auth_user_is_org_admin(user_role.organization_id, (select auth.uid()))
  )
  )
);

create policy "user_role update for org_admin or super_admin"
on public.user_role
for update
to authenticated
using (
  coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
  or (
    user_role.space_id is not null
    and exists (
      select 1
      from public.spaces s
      where s.id = user_role.space_id
        and public.auth_user_is_org_admin(s.organization_id, (select auth.uid()))
    )
  )
  or (
    user_role.organization_id is not null
    and public.auth_user_is_org_admin(user_role.organization_id, (select auth.uid()))
  )
)
with check (
  public.role_assignment_is_valid(
    user_role.role_id,
    user_role.space_id,
    user_role.organization_id
  )
  and (
  coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
  or (
    user_role.space_id is not null
    and exists (
      select 1
      from public.spaces s
      where s.id = user_role.space_id
        and public.auth_user_is_org_admin(s.organization_id, (select auth.uid()))
    )
  )
  or (
    user_role.organization_id is not null
    and public.auth_user_is_org_admin(user_role.organization_id, (select auth.uid()))
  )
  )
);

create policy "user_role delete for org_admin or super_admin"
on public.user_role
for delete
to authenticated
using (
  coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
  or (
    user_role.space_id is not null
    and exists (
      select 1
      from public.spaces s
      where s.id = user_role.space_id
        and public.auth_user_is_org_admin(s.organization_id, (select auth.uid()))
    )
  )
  or (
    user_role.organization_id is not null
    and public.auth_user_is_org_admin(user_role.organization_id, (select auth.uid()))
  )
);

-- ---------------------------------------------------------------------------
-- replace dependent policies and rpc after role-column removal
-- ---------------------------------------------------------------------------

drop policy if exists "organizations update for org_admin" on public.organizations;
create policy "organizations update for org_admin"
on public.organizations
for update
to authenticated
using (
  public.auth_user_is_org_admin(organizations.id, (select auth.uid()))
)
with check (
  public.auth_user_is_org_admin(organizations.id, (select auth.uid()))
);

drop policy if exists "spaces select for space members or super_admin" on public.spaces;
create policy "spaces select for space members or super_admin"
on public.spaces
for select
to authenticated
using (
  coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
  or public.auth_user_active_in_space(spaces.id, (select auth.uid()))
  or public.auth_user_is_org_admin(spaces.organization_id, (select auth.uid()))
);

drop policy if exists "spaces insert for org_admin" on public.spaces;
create policy "spaces insert for org_admin"
on public.spaces
for insert
to authenticated
with check (
  coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
  or public.auth_user_is_org_admin(spaces.organization_id, (select auth.uid()))
);

drop policy if exists "spaces update for org_admin" on public.spaces;
create policy "spaces update for org_admin"
on public.spaces
for update
to authenticated
using (
  coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
  or public.auth_user_is_org_admin(spaces.organization_id, (select auth.uid()))
)
with check (
  coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
  or public.auth_user_is_org_admin(spaces.organization_id, (select auth.uid()))
);

drop policy if exists "spaces delete for org_admin" on public.spaces;
create policy "spaces delete for org_admin"
on public.spaces
for delete
to authenticated
using (
  coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
  or public.auth_user_is_org_admin(spaces.organization_id, (select auth.uid()))
);

drop policy if exists "space_memberships insert for org_admin or super_admin" on public.space_memberships;
create policy "space_memberships insert for org_admin or super_admin"
on public.space_memberships
for insert
to authenticated
with check (
  coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
  or exists (
    select 1
    from public.spaces s
    where s.id = space_memberships.space_id
      and public.auth_user_is_org_admin(s.organization_id, (select auth.uid()))
  )
  or (
    public.auth_user_is_space_admin(space_memberships.space_id, (select auth.uid()))
    and space_memberships.status in ('active', 'invited', 'suspended')
  )
);

drop policy if exists "space_memberships update for org_admin or super_admin" on public.space_memberships;
create policy "space_memberships update for org_admin or super_admin"
on public.space_memberships
for update
to authenticated
using (
  coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
  or exists (
    select 1
    from public.spaces s
    where s.id = space_memberships.space_id
      and public.auth_user_is_org_admin(s.organization_id, (select auth.uid()))
  )
)
with check (
  coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
  or exists (
    select 1
    from public.spaces s
    where s.id = space_memberships.space_id
      and public.auth_user_is_org_admin(s.organization_id, (select auth.uid()))
  )
);

drop policy if exists "space_memberships delete for org_admin or super_admin" on public.space_memberships;
create policy "space_memberships delete for org_admin or super_admin"
on public.space_memberships
for delete
to authenticated
using (
  coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
  or exists (
    select 1
    from public.spaces s
    where s.id = space_memberships.space_id
      and public.auth_user_is_org_admin(s.organization_id, (select auth.uid()))
  )
);

drop policy if exists "organizations delete for super_admin only" on public.organizations;
create policy "organizations delete for super_admin only"
on public.organizations
for delete
to authenticated
using (
  coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
);

drop function if exists public.rpc_create_space_invite(text, text, text);

create or replace function public.rpc_create_space_invite(
  p_space_id text,
  p_email text,
  p_role_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_email text;
  v_role_key text;
  v_role_id text;
  v_selected_role_key text;
  v_org_id text;
  v_id text;
  v_token text;
  v_expires timestamptz;
  v_is_super boolean;
  v_is_org_admin boolean;
  v_is_space_admin boolean;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_email := lower(trim(p_email));
  if v_email = '' then
    raise exception 'Email is required';
  end if;

  v_role_key := lower(trim(p_role_key));
  select s.organization_id into v_org_id
  from public.spaces s
  where s.id = p_space_id;

  if v_org_id is null then
    raise exception 'Space not found';
  end if;

  select r.id, r.key into v_role_id, v_selected_role_key
  from public.roles r
  where r.key = v_role_key
    and r.scope = 'space'
    and r.archived_at is null
    and (
      r.owner_organization_id = v_org_id
      or r.owner_organization_id is null
    )
  order by case when r.owner_organization_id = v_org_id then 0 else 1 end
  limit 1;

  if v_role_id is null then
    raise exception 'Invalid role key';
  end if;

  v_is_super := coalesce((
    select p.is_super_admin from public.profiles p where p.user_id = v_uid
  ), false);

  v_is_org_admin := public.auth_user_is_org_admin(v_org_id, v_uid);
  v_is_space_admin := public.auth_user_is_space_admin(p_space_id, v_uid);

  if not (v_is_super or v_is_org_admin or v_is_space_admin) then
    raise exception 'Not allowed to invite to this space';
  end if;

  if v_selected_role_key = 'space_admin' and not (v_is_super or v_is_org_admin) then
    raise exception 'Only organization admins can grant space admin';
  end if;

  if v_is_space_admin and not (v_is_super or v_is_org_admin) and v_selected_role_key <> 'member' then
    raise exception 'Space admins can only invite member role';
  end if;

  if exists (
    select 1
    from public.space_invites si
    where si.space_id = p_space_id
      and si.email = v_email
      and si.status = 'pending'
  ) then
    raise exception 'A pending invite already exists for this email';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires := timezone('utc', now()) + interval '30 days';

  insert into public.space_invites (
    space_id,
    email,
    role_id,
    status,
    token,
    expires_at,
    created_by_user_id
  )
  values (
    p_space_id,
    v_email,
    v_role_id,
    'pending',
    v_token,
    v_expires,
    v_uid
  )
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'token', v_token,
    'expires_at', v_expires
  );
end;
$$;

revoke all on function public.rpc_create_space_invite(text, text, text) from public;
grant execute on function public.rpc_create_space_invite(text, text, text) to authenticated;

create or replace function public.rpc_revoke_space_invite(p_invite_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_space_id text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select si.space_id into v_space_id
  from public.space_invites si
  where si.id = p_invite_id;

  if v_space_id is null then
    raise exception 'Invite not found';
  end if;

  if not public.auth_user_can_manage_space_invites(v_space_id, v_uid) then
    raise exception 'Not allowed to revoke this invite';
  end if;

  update public.space_invites si
  set
    status = 'revoked',
    updated_at = timezone('utc', now())
  where si.id = p_invite_id
    and si.status = 'pending';

  if not found then
    raise exception 'Invite is not pending';
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.rpc_revoke_space_invite(text) from public;
grant execute on function public.rpc_revoke_space_invite(text) to authenticated;

create or replace function public.rpc_accept_space_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_inv public.space_invites%rowtype;
  v_session_email text;
  v_org_id text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select lower(trim(u.email)) into v_session_email
  from auth.users u
  where u.id = v_uid;

  if v_session_email is null or v_session_email = '' then
    raise exception 'Session has no email';
  end if;

  select si.* into v_inv
  from public.space_invites si
  where si.token = trim(p_token)
  for update;

  if v_inv.id is null then
    raise exception 'Invite not found';
  end if;

  if v_inv.status <> 'pending' then
    raise exception 'Invite is not pending';
  end if;

  if v_inv.expires_at <= timezone('utc', now()) then
    update public.space_invites si
    set
      status = 'expired',
      updated_at = timezone('utc', now())
    where si.id = v_inv.id;
    raise exception 'Invite has expired';
  end if;

  if v_inv.email <> v_session_email then
    raise exception 'Invite email does not match signed-in user';
  end if;

  insert into public.space_memberships (space_id, user_id, status)
  values (v_inv.space_id, v_uid, 'active')
  on conflict (space_id, user_id) do update
  set
    status = 'active',
    updated_at = timezone('utc', now());

  insert into public.user_role (user_id, role_id, space_id)
  select v_uid, v_inv.role_id, v_inv.space_id
  where not exists (
    select 1
    from public.user_role ur
    where ur.user_id = v_uid
      and ur.role_id = v_inv.role_id
      and ur.space_id = v_inv.space_id
      and ur.organization_id is null
  );

  select s.organization_id into v_org_id
  from public.spaces s
  where s.id = v_inv.space_id;

  if v_org_id is not null then
    insert into public.organization_memberships (organization_id, user_id)
    values (v_org_id, v_uid)
    on conflict (organization_id, user_id) do nothing;
  end if;

  update public.space_invites si
  set
    status = 'accepted',
    accepted_by_user_id = v_uid,
    accepted_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  where si.id = v_inv.id;

  return jsonb_build_object('space_id', v_inv.space_id);
end;
$$;

revoke all on function public.rpc_accept_space_invite(text) from public;
grant execute on function public.rpc_accept_space_invite(text) to authenticated;

create or replace function public.rpc_bootstrap_organization_and_space(
  p_org_name text,
  p_org_slug text,
  p_space_name text,
  p_space_slug text,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_org_id text;
  v_space_id text;
  v_org_admin_role_id text;
  v_space_admin_role_id text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if exists (
    select 1
    from public.organization_memberships om
    where om.user_id = v_uid
  ) then
    raise exception 'User already belongs to an organization';
  end if;

  select id into v_org_admin_role_id
  from public.roles
  where key = 'org_admin'
    and role_kind = 'system'
    and owner_organization_id is null
    and archived_at is null
  limit 1;

  select id into v_space_admin_role_id
  from public.roles
  where key = 'space_admin'
    and role_kind = 'system'
    and owner_organization_id is null
    and archived_at is null
  limit 1;

  if v_org_admin_role_id is null or v_space_admin_role_id is null then
    raise exception 'Required RBAC roles are missing';
  end if;

  insert into public.organizations (name, slug)
  values (p_org_name, p_org_slug)
  returning id into v_org_id;

  insert into public.organization_memberships (organization_id, user_id)
  values (v_org_id, v_uid);

  insert into public.user_role (user_id, role_id, organization_id)
  values (v_uid, v_org_admin_role_id, v_org_id);

  insert into public.spaces (organization_id, name, slug)
  values (v_org_id, p_space_name, p_space_slug)
  returning id into v_space_id;

  insert into public.space_memberships (space_id, user_id, status)
  values (v_space_id, v_uid, 'active');

  insert into public.user_role (user_id, role_id, space_id)
  values (v_uid, v_space_admin_role_id, v_space_id);

  insert into public.space_admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    organization_id,
    space_id,
    request_id
  )
  values (
    v_uid,
    'organization.bootstrap',
    'organization',
    v_org_id,
    v_org_id,
    v_space_id,
    nullif(trim(p_request_id), '')
  );

  return jsonb_build_object(
    'organization_id', v_org_id,
    'space_id', v_space_id
  );
end;
$$;

