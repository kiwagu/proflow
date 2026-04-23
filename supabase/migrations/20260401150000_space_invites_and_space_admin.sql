/*
 * Space invites + space-level admin helper.
 *
 * - public.auth_user_is_space_admin: RLS-safe check for space_memberships.role = admin (active).
 * - public.auth_user_can_manage_space_invites: super_admin, org_admin of parent org, or space admin.
 * - public.space_invites: email invites with token; pending uniqueness per (space_id, email).
 * - Extends space_memberships INSERT RLS so space admins may add members only as role authed.
 * - RPCs: rpc_create_space_invite, rpc_revoke_space_invite, rpc_accept_space_invite (accept is the
 *   only path that activates membership from an invite; clients must not mutate invites for accept).
 *
 * Previous single-path migrations remain authoritative for greenfield stacks (no parallel compat layer).
 */

-- ---------------------------------------------------------------------------
-- Helpers (security definer; avoid RLS recursion on space_memberships)
-- ---------------------------------------------------------------------------

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
    from public.space_memberships sm
    where sm.space_id = p_space_id
      and sm.user_id = p_user_id
      and sm.status = 'active'
      and sm.role = 'admin'
  );
$$;

comment on function public.auth_user_is_space_admin(text, uuid) is
  'True when the user is an active space admin for the given space (RLS-safe).';

alter function public.auth_user_is_space_admin(text, uuid) owner to postgres;

revoke all on function public.auth_user_is_space_admin(text, uuid) from public;
grant execute on function public.auth_user_is_space_admin(text, uuid) to authenticated;

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

comment on function public.auth_user_can_manage_space_invites(text, uuid) is
  'Who may create/revoke space invites: super_admin, org_admin of the space org, or space admin.';

alter function public.auth_user_can_manage_space_invites(text, uuid) owner to postgres;

revoke all on function public.auth_user_can_manage_space_invites(text, uuid) from public;
grant execute on function public.auth_user_can_manage_space_invites(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- space_invites
-- ---------------------------------------------------------------------------

create table public.space_invites (
  id text primary key default public.entity_id_generate('spi'),
  space_id text not null references public.spaces (id) on delete cascade,
  email text not null,
  role text not null default 'authed' check (role in ('authed', 'admin')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  token text not null,
  expires_at timestamptz not null,
  created_by_user_id uuid not null,
  accepted_by_user_id uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.space_invites is
  'Pending and historical invitations to join a space by email; accept flow uses rpc_accept_space_invite.';

comment on column public.space_invites.email is
  'Normalized to lower(trim(...)) via trigger before insert/update.';

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

alter table public.space_invites enable row level security;

revoke all on public.space_invites from public;
grant select on public.space_invites to authenticated;

-- Invitee sees their own pending (and historical) rows by email claim.
create policy "space_invites select for invitee by jwt email"
on public.space_invites
for select
to authenticated
using (
  space_invites.email = lower(trim(coalesce((select auth.jwt()->>'email'), '')))
);

-- Managers see invites for spaces they administer.
create policy "space_invites select for space invite managers"
on public.space_invites
for select
to authenticated
using (
  public.auth_user_can_manage_space_invites(space_invites.space_id, (select auth.uid()))
);

-- No direct insert/update/delete for authenticated: RPCs only.

-- ---------------------------------------------------------------------------
-- space_memberships: allow space admins to insert authed members only
-- ---------------------------------------------------------------------------

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
    and space_memberships.role = 'authed'
    and space_memberships.status in ('active', 'invited', 'suspended')
  )
);

-- ---------------------------------------------------------------------------
-- RPC: create invite (returns token once for sharing)
-- ---------------------------------------------------------------------------

create or replace function public.rpc_create_space_invite(
  p_space_id text,
  p_email text,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_email text;
  v_role text;
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

  v_role := lower(trim(p_role));
  if v_role not in ('authed', 'admin') then
    raise exception 'Invalid role';
  end if;

  select s.organization_id into v_org_id
  from public.spaces s
  where s.id = p_space_id;

  if v_org_id is null then
    raise exception 'Space not found';
  end if;

  v_is_super := coalesce((
    select p.is_super_admin from public.profiles p where p.user_id = v_uid
  ), false);

  v_is_org_admin := public.auth_user_is_org_admin(v_org_id, v_uid);
  v_is_space_admin := public.auth_user_is_space_admin(p_space_id, v_uid);

  if not (v_is_super or v_is_org_admin or v_is_space_admin) then
    raise exception 'Not allowed to invite to this space';
  end if;

  if v_role = 'admin' and not (v_is_super or v_is_org_admin) then
    raise exception 'Only organization admins can grant space admin';
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
    role,
    status,
    token,
    expires_at,
    created_by_user_id
  )
  values (
    p_space_id,
    v_email,
    v_role,
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

comment on function public.rpc_create_space_invite(text, text, text) is
  'Creates a pending space invite; space admins may only invite role authed.';

alter function public.rpc_create_space_invite(text, text, text) owner to postgres;

revoke all on function public.rpc_create_space_invite(text, text, text) from public;
grant execute on function public.rpc_create_space_invite(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: revoke pending invite
-- ---------------------------------------------------------------------------

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

comment on function public.rpc_revoke_space_invite(text) is
  'Sets a pending invite to revoked when the caller can manage invites for that space.';

alter function public.rpc_revoke_space_invite(text) owner to postgres;

revoke all on function public.rpc_revoke_space_invite(text) from public;
grant execute on function public.rpc_revoke_space_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: accept invite (membership + invite state; bypasses membership RLS safely)
-- ---------------------------------------------------------------------------

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

  insert into public.space_memberships (space_id, user_id, status, role)
  values (v_inv.space_id, v_uid, 'active', v_inv.role)
  on conflict (space_id, user_id) do update
  set
    status = 'active',
    role = excluded.role,
    updated_at = timezone('utc', now());

  select s.organization_id into v_org_id
  from public.spaces s
  where s.id = v_inv.space_id;

  if v_org_id is not null then
    insert into public.organization_memberships (organization_id, user_id, role)
    values (v_org_id, v_uid, 'member')
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

comment on function public.rpc_accept_space_invite(text) is
  'Accepts a pending non-expired invite for the current auth user email; sets membership active.';

alter function public.rpc_accept_space_invite(text) owner to postgres;

revoke all on function public.rpc_accept_space_invite(text) from public;
grant execute on function public.rpc_accept_space_invite(text) to authenticated;
