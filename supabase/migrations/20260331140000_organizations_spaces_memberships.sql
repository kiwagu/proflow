/*
 * organizations (1) -> spaces (N), strict 1:N.
 * space_memberships: user <-> space.
 * organization_memberships: user <-> org with role (org_admin | member) for org-scoped admin actions.
 * space_admin_audit_log: lightweight append-only audit (before full section 9).
 *
 * Seed: two organizations and one space each (non-empty tables for dev/tests).
 * No legacy backfill: greenfield only.
 *
 * RLS: SELECT policies must not use EXISTS subqueries on the same table as the policy
 * (PostgreSQL reports infinite recursion). Use auth_user_active_in_space / auth_user_member_of_org.
 */

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
create table public.organizations (
  id text primary key default public.entity_id_generate('org'),
  name text not null,
  slug text not null,
  avatar_url text,
  parent_organization_id text references public.organizations (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.organizations is 'Enterprise grouping: billing, org_admin scope; 1:N to spaces.';
comment on column public.organizations.avatar_url is 'Public URL of the organization avatar image.';

create unique index organizations_slug_key on public.organizations (slug);

create index organizations_parent_organization_id_idx
  on public.organizations (parent_organization_id)
  where parent_organization_id is not null;

-- ---------------------------------------------------------------------------
-- spaces (data isolation boundary; FK to exactly one organization)
-- ---------------------------------------------------------------------------
create table public.spaces (
  id text primary key default public.entity_id_generate('spc'),
  organization_id text not null references public.organizations (id) on delete cascade,
  name text not null,
  slug text not null,
  avatar_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.spaces is 'Space is the hard isolation key for RLS and storage; belongs to one organization.';
comment on column public.spaces.avatar_url is 'Public URL of the space avatar image.';

create unique index spaces_slug_key on public.spaces (slug);

create index spaces_organization_id_idx on public.spaces (organization_id);

-- ---------------------------------------------------------------------------
-- space_memberships
-- ---------------------------------------------------------------------------
create table public.space_memberships (
  space_id text not null references public.spaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'invited', 'suspended')),
  role text not null default 'authed' check (role in ('authed', 'admin')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (space_id, user_id)
);

comment on table public.space_memberships is 'Links Supabase auth users to spaces with membership status.';

comment on column public.space_memberships.role is
  'Space-level capability: authed = normal member; admin = can manage invites for this space (not org-wide).';

create index space_memberships_user_id_idx on public.space_memberships (user_id);

-- ---------------------------------------------------------------------------
-- organization_memberships (org_admin vs member)
-- ---------------------------------------------------------------------------
create table public.organization_memberships (
  organization_id text not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('org_admin', 'member')),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (organization_id, user_id)
);

comment on table public.organization_memberships is 'Org-level roles; org_admin may create spaces under the org (app + RLS).';

create index organization_memberships_user_id_idx on public.organization_memberships (user_id);

-- ---------------------------------------------------------------------------
-- profiles: super_admin flag (narrow global operator; section 3 alignment)
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists is_super_admin boolean not null default false;

comment on column public.profiles.is_super_admin is 'Platform super_admin allowlist; global settings and documented breaks only.';

create or replace function public.profiles_prevent_super_admin_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'update' then
    return new;
  end if;
  if new.is_super_admin is distinct from old.is_super_admin then
    if auth.uid() is null then
      return new;
    end if;
    if not coalesce(
      (select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())),
      false
    ) then
      raise exception 'profiles: is_super_admin cannot be changed without existing super_admin privilege';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_super_admin_escalation on public.profiles;
create trigger profiles_prevent_super_admin_escalation
before update on public.profiles
for each row
execute function public.profiles_prevent_super_admin_escalation();

-- ---------------------------------------------------------------------------
-- lightweight audit (expand to section 9 later)
-- ---------------------------------------------------------------------------
create table public.space_admin_audit_log (
  id text primary key default public.entity_id_generate('sal'),
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  organization_id text references public.organizations (id) on delete set null,
  space_id text references public.spaces (id) on delete set null,
  request_id text,
  created_at timestamptz not null default timezone('utc', now())
);

comment on table public.space_admin_audit_log is 'Append-only admin/security events for org/space/membership lifecycle.';

create index space_admin_audit_log_created_at_idx on public.space_admin_audit_log (created_at desc);

create index space_admin_audit_log_space_id_idx on public.space_admin_audit_log (space_id)
  where space_id is not null;

-- ---------------------------------------------------------------------------
-- updated_at triggers (reuse pattern from profiles)
-- ---------------------------------------------------------------------------
create or replace function public.set_organizations_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create trigger organizations_set_updated_at
before update on public.organizations
for each row
execute function public.set_organizations_updated_at();

create or replace function public.set_spaces_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create trigger spaces_set_updated_at
before update on public.spaces
for each row
execute function public.set_spaces_updated_at();

create or replace function public.set_space_memberships_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create trigger space_memberships_set_updated_at
before update on public.space_memberships
for each row
execute function public.set_space_memberships_updated_at();

-- ---------------------------------------------------------------------------
-- RLS-safe membership helpers (security definer; avoids self-referential policy recursion)
-- ---------------------------------------------------------------------------

create or replace function public.auth_user_active_in_space(
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
    from public.space_memberships sm
    where sm.space_id = p_space_id
      and sm.user_id = p_user_id
      and sm.status = 'active'
  );
$$;

comment on function public.auth_user_active_in_space(text, uuid) is
  'RLS-safe membership probe: used by policies to avoid self-referential EXISTS on space_memberships.';

create or replace function public.auth_user_member_of_org(
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
    from public.organization_memberships om
    where om.organization_id = p_organization_id
      and om.user_id = p_user_id
  );
$$;

comment on function public.auth_user_member_of_org(text, uuid) is
  'RLS-safe org membership probe: used by policies to avoid self-referential EXISTS on organization_memberships.';

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
    from public.organization_memberships om
    where om.organization_id = p_organization_id
      and om.user_id = p_user_id
      and om.role = 'org_admin'
  );
$$;

comment on function public.auth_user_is_org_admin(text, uuid) is
  'RLS-safe org_admin check for spaces and membership policies. Future: enforce plan/tier limits or org settings here.';

revoke all on function public.auth_user_active_in_space(text, uuid) from public;
revoke all on function public.auth_user_member_of_org(text, uuid) from public;
revoke all on function public.auth_user_is_org_admin(text, uuid) from public;

grant execute on function public.auth_user_active_in_space(text, uuid) to authenticated;
grant execute on function public.auth_user_member_of_org(text, uuid) to authenticated;
grant execute on function public.auth_user_is_org_admin(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.spaces enable row level security;
alter table public.space_memberships enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.space_admin_audit_log enable row level security;

-- organizations: read if user has active space membership under this org OR org membership OR super_admin
create policy "organizations select for members or org members or super_admin"
on public.organizations
for select
to authenticated
using (
  coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
  or exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = organizations.id
      and om.user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.space_memberships sm
    join public.spaces s on s.id = sm.space_id
    where s.organization_id = organizations.id
      and sm.user_id = (select auth.uid())
      and sm.status = 'active'
  )
);

-- spaces: read if member, org_admin of parent org, or super_admin (org_admin needs SELECT for INSERT RETURNING before space_membership exists)
create policy "spaces select for space members or super_admin"
on public.spaces
for select
to authenticated
using (
  coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
  or public.auth_user_active_in_space(spaces.id, (select auth.uid()))
  or public.auth_user_is_org_admin(spaces.organization_id, (select auth.uid()))
);

-- spaces: insert/update/delete if org_admin for this organization (RLS-safe helper; no raw EXISTS on organization_memberships)
create policy "spaces insert for org_admin"
on public.spaces
for insert
to authenticated
with check (
  coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
  or public.auth_user_is_org_admin(spaces.organization_id, (select auth.uid()))
);

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

create policy "spaces delete for org_admin"
on public.spaces
for delete
to authenticated
using (
  coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
  or public.auth_user_is_org_admin(spaces.organization_id, (select auth.uid()))
);

-- space_memberships: see co-members in same space, own row, or super_admin
create policy "space_memberships select for co-members or super_admin"
on public.space_memberships
for select
to authenticated
using (
  coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
  or space_memberships.user_id = (select auth.uid())
  or public.auth_user_active_in_space(space_memberships.space_id, (select auth.uid()))
);

-- insert/update membership: org_admin of parent org or super_admin (join spaces only; org_admin check via helper)
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
);

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

-- organization_memberships
create policy "organization_memberships select for members or super_admin"
on public.organization_memberships
for select
to authenticated
using (
  coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
  or organization_memberships.user_id = (select auth.uid())
  or public.auth_user_member_of_org(organization_memberships.organization_id, (select auth.uid()))
);

create policy "organization_memberships insert for super_admin only"
on public.organization_memberships
for insert
to authenticated
with check (
  coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
);

create policy "organization_memberships update for super_admin only"
on public.organization_memberships
for update
to authenticated
using (
  coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
)
with check (
  coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
);

create policy "organization_memberships delete for super_admin only"
on public.organization_memberships
for delete
to authenticated
using (
  coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
);

-- audit log: read for super_admin or actor; insert via app/service (authenticated insert with check actor = self)
create policy "space_admin_audit_log select for super_admin or actor"
on public.space_admin_audit_log
for select
to authenticated
using (
  coalesce((select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())), false) = true
  or space_admin_audit_log.actor_user_id = (select auth.uid())
);

create policy "space_admin_audit_log insert for authenticated actor self"
on public.space_admin_audit_log
for insert
to authenticated
with check (
  space_admin_audit_log.actor_user_id = (select auth.uid())
);

-- ---------------------------------------------------------------------------
-- seed: two orgs, two spaces (one space per org)
-- ---------------------------------------------------------------------------
with ins_org as (
  insert into public.organizations (id, name, slug)
  values
    (public.entity_id_generate('org'), 'Seed Org Alpha', 'seed-org-alpha'),
    (public.entity_id_generate('org'), 'Seed Org Beta', 'seed-org-beta')
  returning id, slug
),
map as (
  select id, slug from ins_org
)
insert into public.spaces (id, organization_id, name, slug)
select
  public.entity_id_generate('spc'),
  m.id,
  case m.slug
    when 'seed-org-alpha' then 'Seed Space Alpha'
    else 'Seed Space Beta'
  end,
  case m.slug
    when 'seed-org-alpha' then 'seed-space-alpha'
    else 'seed-space-beta'
  end
from map m;
