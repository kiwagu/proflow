/*
 * critical capability path (private + jit)
 *
 * purpose:
 * - replace broad profiles.is_super_admin checks with private critical capability checks
 * - add break-glass jit sessions with ttl and audit events
 * - keep critical capability visibility out of app-facing user models
 */

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- private storage
-- ---------------------------------------------------------------------------

create table if not exists private.operator_capability_grant (
  id text primary key default public.entity_id_generate('ocg'),
  user_id uuid not null references auth.users (id) on delete cascade,
  capability_key text not null,
  reason text,
  granted_by_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  revoked_at timestamptz,
  revoked_by_user_id uuid references auth.users (id) on delete set null,
  revoke_reason text
);

create unique index if not exists operator_capability_grant_active_unique_idx
  on private.operator_capability_grant (user_id, capability_key)
  where revoked_at is null;

create table if not exists private.operator_capability_session (
  id text primary key default public.entity_id_generate('ocs'),
  user_id uuid not null references auth.users (id) on delete cascade,
  capability_key text not null,
  reason text not null,
  started_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  ended_at timestamptz,
  ended_reason text
);

create index if not exists operator_capability_session_active_idx
  on private.operator_capability_session (user_id, capability_key, expires_at)
  where ended_at is null;

create table if not exists private.operator_capability_audit (
  id text primary key default public.entity_id_generate('oca'),
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  capability_key text not null,
  target_user_id uuid references auth.users (id) on delete set null,
  session_id text references private.operator_capability_session (id) on delete set null,
  request_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists operator_capability_audit_actor_created_idx
  on private.operator_capability_audit (actor_user_id, created_at desc);

create index if not exists operator_capability_audit_capability_created_idx
  on private.operator_capability_audit (capability_key, created_at desc);

create table if not exists private.operator_capability_bootstrap_state (
  capability_key text primary key,
  target_user_id uuid references auth.users (id) on delete set null,
  target_email text not null,
  sealed_at timestamptz not null default timezone('utc', now()),
  detail jsonb not null default '{}'::jsonb
);

create index if not exists operator_capability_bootstrap_target_idx
  on private.operator_capability_bootstrap_state (target_user_id);

-- ---------------------------------------------------------------------------
-- capability helpers
-- ---------------------------------------------------------------------------

create or replace function private.user_has_critical_capability(
  p_user_id uuid,
  p_capability_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from private.operator_capability_grant g
      where g.user_id = p_user_id
        and g.capability_key = p_capability_key
        and g.revoked_at is null
    )
    or exists (
      select 1
      from private.operator_capability_session s
      where s.user_id = p_user_id
        and s.capability_key = p_capability_key
        and s.ended_at is null
        and s.expires_at > timezone('utc', now())
    );
$$;

revoke all on function private.user_has_critical_capability(uuid, text) from public;

create or replace function public.auth_user_has_critical_capability(
  p_user_id uuid,
  p_capability_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.user_has_critical_capability(p_user_id, p_capability_key);
$$;

revoke all on function public.auth_user_has_critical_capability(uuid, text) from public;
grant execute on function public.auth_user_has_critical_capability(uuid, text) to service_role;

create or replace function public.auth_current_user_has_critical_capability(
  p_capability_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    case
      when auth.uid() is null then false
      else private.user_has_critical_capability(auth.uid(), p_capability_key)
    end;
$$;

revoke all on function public.auth_current_user_has_critical_capability(text) from public;
grant execute on function public.auth_current_user_has_critical_capability(text) to authenticated;

create or replace function public.rpc_bootstrap_initial_platform_super_admin(
  p_user_id uuid,
  p_expected_email text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capability constant text := 'platform.admin.override';
  v_grant_id text;
  v_active_count integer;
  v_target_email text;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if p_user_id is null then
    raise exception 'Target user is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('private.operator_capability_bootstrap.platform.admin.override', 0)
  );

  if exists (
    select 1
    from private.operator_capability_bootstrap_state s
    where s.capability_key = v_capability
  ) then
    return jsonb_build_object('ok', true, 'status', 'already_sealed');
  end if;

  select lower(trim(coalesce(u.email, '')))
    into v_target_email
  from auth.users u
  where u.id = p_user_id;

  if v_target_email is null then
    raise exception 'Target user not found';
  end if;

  if nullif(trim(coalesce(p_expected_email, '')), '') is not null
     and v_target_email <> lower(trim(p_expected_email)) then
    raise exception 'Target user email does not match configured bootstrap email';
  end if;

  select g.id
    into v_grant_id
  from private.operator_capability_grant g
  where g.user_id = p_user_id
    and g.capability_key = v_capability
    and g.revoked_at is null
  limit 1;

  select count(*)
    into v_active_count
  from private.operator_capability_grant g
  where g.capability_key = v_capability
    and g.revoked_at is null;

  if v_grant_id is not null then
    insert into private.operator_capability_bootstrap_state (
      capability_key,
      target_user_id,
      target_email,
      detail
    )
    values (
      v_capability,
      p_user_id,
      v_target_email,
      jsonb_build_object(
        'reason', coalesce(v_reason, 'env bootstrap seal existing grant'),
        'status', 'sealed_existing_grant'
      )
    );

    insert into private.operator_capability_audit (
      actor_user_id,
      action,
      capability_key,
      target_user_id,
      detail
    )
    values (
      null,
      'grant.bootstrap.seal_existing',
      v_capability,
      p_user_id,
      jsonb_build_object(
        'grant_id', v_grant_id,
        'target_email', v_target_email,
        'reason', coalesce(v_reason, 'env bootstrap seal existing grant')
      )
    );

    return jsonb_build_object(
      'ok', true,
      'status', 'sealed_existing_grant',
      'grant_id', v_grant_id
    );
  end if;

  if v_active_count > 0 then
    return jsonb_build_object(
      'ok', true,
      'status', 'skipped_existing_super_admins'
    );
  end if;

  insert into private.operator_capability_grant (
    user_id,
    capability_key,
    reason,
    granted_by_user_id
  )
  values (
    p_user_id,
    v_capability,
    coalesce(v_reason, 'env bootstrap initial platform super admin'),
    null
  )
  returning id into v_grant_id;

  insert into private.operator_capability_bootstrap_state (
    capability_key,
    target_user_id,
    target_email,
    detail
  )
  values (
    v_capability,
    p_user_id,
    v_target_email,
    jsonb_build_object(
      'grant_id', v_grant_id,
      'reason', coalesce(v_reason, 'env bootstrap initial platform super admin'),
      'status', 'granted'
    )
  );

  insert into private.operator_capability_audit (
    actor_user_id,
    action,
    capability_key,
    target_user_id,
    detail
  )
  values (
    null,
    'grant.bootstrap_initial',
    v_capability,
    p_user_id,
    jsonb_build_object(
      'grant_id', v_grant_id,
      'target_email', v_target_email,
      'reason', coalesce(v_reason, 'env bootstrap initial platform super admin')
    )
  );

  return jsonb_build_object('ok', true, 'status', 'granted', 'grant_id', v_grant_id);
end;
$$;

revoke all on function public.rpc_bootstrap_initial_platform_super_admin(uuid, text, text) from public;
grant execute on function public.rpc_bootstrap_initial_platform_super_admin(uuid, text, text) to service_role;

create or replace function public.rpc_grant_platform_super_admin(
  p_target_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_capability constant text := 'platform.admin.override';
  v_grant_id text;
  v_active_count integer;
  v_reason text;
begin
  if v_actor_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_target_user_id is null then
    raise exception 'Target user is required';
  end if;

  if not public.auth_current_user_has_critical_capability(v_capability) then
    raise exception 'Not allowed to grant platform super admin';
  end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'Reason is required';
  end if;

  perform 1
  from auth.users u
  where u.id = p_target_user_id;

  if not found then
    raise exception 'Target user not found';
  end if;

  select g.id
    into v_grant_id
  from private.operator_capability_grant g
  where g.user_id = p_target_user_id
    and g.capability_key = v_capability
    and g.revoked_at is null
  limit 1;

  if v_grant_id is not null then
    return jsonb_build_object(
      'ok', true,
      'status', 'already_granted',
      'grant_id', v_grant_id
    );
  end if;

  select count(*)
    into v_active_count
  from private.operator_capability_grant g
  where g.capability_key = v_capability
    and g.revoked_at is null;

  if v_active_count >= 3 then
    raise exception 'No more than 3 active platform super admins allowed';
  end if;

  insert into private.operator_capability_grant (
    user_id,
    capability_key,
    reason,
    granted_by_user_id
  )
  values (
    p_target_user_id,
    v_capability,
    v_reason,
    v_actor_user_id
  )
  returning id into v_grant_id;

  insert into private.operator_capability_audit (
    actor_user_id,
    action,
    capability_key,
    target_user_id,
    detail
  )
  values (
    v_actor_user_id,
    'grant.platform_super_admin',
    v_capability,
    p_target_user_id,
    jsonb_build_object('grant_id', v_grant_id, 'reason', v_reason)
  );

  return jsonb_build_object('ok', true, 'status', 'granted', 'grant_id', v_grant_id);
end;
$$;

revoke all on function public.rpc_grant_platform_super_admin(uuid, text) from public;
grant execute on function public.rpc_grant_platform_super_admin(uuid, text) to authenticated;

create or replace function public.rpc_revoke_platform_super_admin(
  p_target_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_capability constant text := 'platform.admin.override';
  v_grant_id text;
  v_active_count integer;
  v_reason text;
begin
  if v_actor_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_target_user_id is null then
    raise exception 'Target user is required';
  end if;

  if not public.auth_current_user_has_critical_capability(v_capability) then
    raise exception 'Not allowed to revoke platform super admin';
  end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'Reason is required';
  end if;

  select g.id
    into v_grant_id
  from private.operator_capability_grant g
  where g.user_id = p_target_user_id
    and g.capability_key = v_capability
    and g.revoked_at is null
  limit 1;

  if v_grant_id is null then
    return jsonb_build_object(
      'ok', true,
      'status', 'already_revoked'
    );
  end if;

  select count(*)
    into v_active_count
  from private.operator_capability_grant g
  where g.capability_key = v_capability
    and g.revoked_at is null;

  if v_active_count <= 1 then
    raise exception 'At least 1 active platform super admin is required';
  end if;

  update private.operator_capability_grant
  set revoked_at = timezone('utc', now()),
      revoked_by_user_id = v_actor_user_id,
      revoke_reason = v_reason
  where id = v_grant_id;

  insert into private.operator_capability_audit (
    actor_user_id,
    action,
    capability_key,
    target_user_id,
    detail
  )
  values (
    v_actor_user_id,
    'revoke.platform_super_admin',
    v_capability,
    p_target_user_id,
    jsonb_build_object('grant_id', v_grant_id, 'reason', v_reason)
  );

  return jsonb_build_object('ok', true, 'status', 'revoked', 'grant_id', v_grant_id);
end;
$$;

revoke all on function public.rpc_revoke_platform_super_admin(uuid, text) from public;
grant execute on function public.rpc_revoke_platform_super_admin(uuid, text) to authenticated;

create or replace function public.rpc_service_role_grant_platform_super_admin(
  p_target_user_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capability constant text := 'platform.admin.override';
  v_grant_id text;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if p_target_user_id is null then
    raise exception 'Target user is required';
  end if;

  perform 1
  from auth.users u
  where u.id = p_target_user_id;

  if not found then
    raise exception 'Target user not found';
  end if;

  select g.id
    into v_grant_id
  from private.operator_capability_grant g
  where g.user_id = p_target_user_id
    and g.capability_key = v_capability
    and g.revoked_at is null
  limit 1;

  if v_grant_id is not null then
    return jsonb_build_object(
      'ok', true,
      'status', 'already_granted',
      'grant_id', v_grant_id
    );
  end if;

  insert into private.operator_capability_grant (
    user_id,
    capability_key,
    reason,
    granted_by_user_id
  )
  values (
    p_target_user_id,
    v_capability,
    coalesce(v_reason, 'service-role platform super admin grant'),
    null
  )
  returning id into v_grant_id;

  insert into private.operator_capability_audit (
    actor_user_id,
    action,
    capability_key,
    target_user_id,
    detail
  )
  values (
    null,
    'grant.platform_super_admin.service_role',
    v_capability,
    p_target_user_id,
    jsonb_build_object(
      'grant_id', v_grant_id,
      'reason', coalesce(v_reason, 'service-role platform super admin grant')
    )
  );

  return jsonb_build_object(
    'ok', true,
    'status', 'granted',
    'grant_id', v_grant_id
  );
end;
$$;

revoke all on function public.rpc_service_role_grant_platform_super_admin(uuid, text) from public;
grant execute on function public.rpc_service_role_grant_platform_super_admin(uuid, text) to service_role;

create or replace function public.rpc_service_role_list_platform_super_admin_grants()
returns table (
  user_id uuid,
  granted_at timestamptz,
  granted_by_user_id uuid,
  reason text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    g.user_id,
    g.created_at as granted_at,
    g.granted_by_user_id,
    g.reason
  from private.operator_capability_grant g
  where g.capability_key = 'platform.admin.override'
    and g.revoked_at is null
  order by g.created_at asc;
$$;

revoke all on function public.rpc_service_role_list_platform_super_admin_grants() from public;
grant execute on function public.rpc_service_role_list_platform_super_admin_grants() to service_role;

create or replace function public.rpc_start_break_glass(
  p_capability_key text,
  p_reason text,
  p_ttl_minutes int default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_capability text;
  v_reason text;
  v_ttl int;
  v_session_id text;
  v_expires_at timestamptz;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_capability := trim(p_capability_key);
  if v_capability = '' then
    raise exception 'Capability key is required';
  end if;

  v_reason := trim(p_reason);
  if v_reason = '' then
    raise exception 'Reason is required';
  end if;

  if not exists (
    select 1
    from private.operator_capability_grant g
    where g.user_id = v_uid
      and g.capability_key = v_capability
      and g.revoked_at is null
  ) then
    raise exception 'Not allowed to start break-glass for this capability';
  end if;

  v_ttl := coalesce(p_ttl_minutes, 30);
  if v_ttl < 1 or v_ttl > 240 then
    raise exception 'TTL must be between 1 and 240 minutes';
  end if;

  v_expires_at := timezone('utc', now()) + make_interval(mins => v_ttl);

  insert into private.operator_capability_session (
    user_id,
    capability_key,
    reason,
    expires_at
  )
  values (
    v_uid,
    v_capability,
    v_reason,
    v_expires_at
  )
  returning id into v_session_id;

  insert into private.operator_capability_audit (
    actor_user_id,
    action,
    capability_key,
    target_user_id,
    session_id,
    detail
  )
  values (
    v_uid,
    'break_glass.start',
    v_capability,
    v_uid,
    v_session_id,
    jsonb_build_object('ttl_minutes', v_ttl, 'reason', v_reason)
  );

  return jsonb_build_object(
    'session_id', v_session_id,
    'expires_at', v_expires_at
  );
end;
$$;

revoke all on function public.rpc_start_break_glass(text, text, int) from public;
grant execute on function public.rpc_start_break_glass(text, text, int) to authenticated;

create or replace function public.rpc_end_break_glass(
  p_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_capability text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  update private.operator_capability_session s
  set
    ended_at = timezone('utc', now()),
    ended_reason = 'manual_end'
  where s.id = p_session_id
    and s.user_id = v_uid
    and s.ended_at is null
  returning s.capability_key into v_capability;

  if v_capability is null then
    raise exception 'Break-glass session not found';
  end if;

  insert into private.operator_capability_audit (
    actor_user_id,
    action,
    capability_key,
    target_user_id,
    session_id
  )
  values (
    v_uid,
    'break_glass.end',
    v_capability,
    v_uid,
    p_session_id
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.rpc_end_break_glass(text) from public;
grant execute on function public.rpc_end_break_glass(text) to authenticated;

-- ---------------------------------------------------------------------------
-- policy rewires from profiles.is_super_admin to critical capability
-- ---------------------------------------------------------------------------

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
    public.auth_user_has_critical_capability(p_user_id, 'platform.admin.override')
    or exists (
      select 1
      from public.spaces s
      where s.id = p_space_id
        and public.auth_user_is_org_admin(s.organization_id, p_user_id)
    )
    or public.auth_user_is_space_admin(p_space_id, p_user_id);
$$;

drop policy if exists "organizations select for members or org members or super_admin" on public.organizations;
create policy "organizations select for members or org members or super_admin"
on public.organizations
for select
to authenticated
using (
  public.auth_current_user_has_critical_capability('platform.admin.override')
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

drop policy if exists "spaces select for space members or super_admin" on public.spaces;
create policy "spaces select for space members or super_admin"
on public.spaces
for select
to authenticated
using (
  public.auth_current_user_has_critical_capability('platform.admin.override')
  or public.auth_user_active_in_space(spaces.id, (select auth.uid()))
  or public.auth_user_is_org_admin(spaces.organization_id, (select auth.uid()))
);

drop policy if exists "spaces insert for org_admin" on public.spaces;
create policy "spaces insert for org_admin"
on public.spaces
for insert
to authenticated
with check (
  public.auth_current_user_has_critical_capability('platform.admin.override')
  or public.auth_user_is_org_admin(spaces.organization_id, (select auth.uid()))
);

drop policy if exists "spaces update for org_admin" on public.spaces;
create policy "spaces update for org_admin"
on public.spaces
for update
to authenticated
using (
  public.auth_current_user_has_critical_capability('platform.admin.override')
  or public.auth_user_is_org_admin(spaces.organization_id, (select auth.uid()))
)
with check (
  public.auth_current_user_has_critical_capability('platform.admin.override')
  or public.auth_user_is_org_admin(spaces.organization_id, (select auth.uid()))
);

drop policy if exists "spaces delete for org_admin" on public.spaces;
create policy "spaces delete for org_admin"
on public.spaces
for delete
to authenticated
using (
  public.auth_current_user_has_critical_capability('platform.admin.override')
  or public.auth_user_is_org_admin(spaces.organization_id, (select auth.uid()))
);

drop policy if exists "space_memberships select for co-members or super_admin" on public.space_memberships;
create policy "space_memberships select for co-members or super_admin"
on public.space_memberships
for select
to authenticated
using (
  public.auth_current_user_has_critical_capability('platform.admin.override')
  or space_memberships.user_id = (select auth.uid())
  or public.auth_user_active_in_space(space_memberships.space_id, (select auth.uid()))
);

drop policy if exists "space_memberships insert for org_admin or super_admin" on public.space_memberships;
create policy "space_memberships insert for org_admin or super_admin"
on public.space_memberships
for insert
to authenticated
with check (
  public.auth_current_user_has_critical_capability('platform.admin.override')
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
  public.auth_current_user_has_critical_capability('platform.admin.override')
  or exists (
    select 1
    from public.spaces s
    where s.id = space_memberships.space_id
      and public.auth_user_is_org_admin(s.organization_id, (select auth.uid()))
  )
)
with check (
  public.auth_current_user_has_critical_capability('platform.admin.override')
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
  public.auth_current_user_has_critical_capability('platform.admin.override')
  or exists (
    select 1
    from public.spaces s
    where s.id = space_memberships.space_id
      and public.auth_user_is_org_admin(s.organization_id, (select auth.uid()))
  )
);

drop policy if exists "organization_memberships select for members or super_admin" on public.organization_memberships;
create policy "organization_memberships select for members or super_admin"
on public.organization_memberships
for select
to authenticated
using (
  public.auth_current_user_has_critical_capability('platform.admin.override')
  or organization_memberships.user_id = (select auth.uid())
  or public.auth_user_member_of_org(organization_memberships.organization_id, (select auth.uid()))
);

drop policy if exists "organization_memberships insert for super_admin only" on public.organization_memberships;
create policy "organization_memberships insert for super_admin only"
on public.organization_memberships
for insert
to authenticated
with check (
  public.auth_current_user_has_critical_capability('platform.admin.override')
);

drop policy if exists "organization_memberships update for super_admin only" on public.organization_memberships;
create policy "organization_memberships update for super_admin only"
on public.organization_memberships
for update
to authenticated
using (
  public.auth_current_user_has_critical_capability('platform.admin.override')
)
with check (
  public.auth_current_user_has_critical_capability('platform.admin.override')
);

drop policy if exists "organization_memberships delete for super_admin only" on public.organization_memberships;
create policy "organization_memberships delete for super_admin only"
on public.organization_memberships
for delete
to authenticated
using (
  public.auth_current_user_has_critical_capability('platform.admin.override')
);

drop policy if exists "space_admin_audit_log select for super_admin or actor" on public.space_admin_audit_log;
create policy "space_admin_audit_log select for super_admin or actor"
on public.space_admin_audit_log
for select
to authenticated
using (
  public.auth_current_user_has_critical_capability('platform.admin.override')
  or space_admin_audit_log.actor_user_id = (select auth.uid())
);

drop policy if exists "organizations delete for super_admin only" on public.organizations;
create policy "organizations delete for super_admin only"
on public.organizations
for delete
to authenticated
using (
  public.auth_current_user_has_critical_capability('platform.admin.override')
);

drop policy if exists "roles insert for org_admin or super_admin" on public.roles;
create policy "roles insert for org_admin or super_admin"
on public.roles
for insert
to authenticated
with check (
  (
    public.auth_current_user_has_critical_capability('platform.admin.override')
    and roles.role_kind = 'system'
    and roles.is_baseline = false
  )
  or (
    roles.role_kind = 'custom'
    and roles.owner_organization_id is not null
    and public.auth_user_is_org_admin(roles.owner_organization_id, (select auth.uid()))
  )
);

drop policy if exists "roles update for org_admin or super_admin" on public.roles;
create policy "roles update for org_admin or super_admin"
on public.roles
for update
to authenticated
using (
  (
    public.auth_current_user_has_critical_capability('platform.admin.override')
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
    public.auth_current_user_has_critical_capability('platform.admin.override')
    and roles.role_kind = 'system'
    and roles.is_baseline = false
  )
  or (
    roles.role_kind = 'custom'
    and roles.owner_organization_id is not null
    and public.auth_user_is_org_admin(roles.owner_organization_id, (select auth.uid()))
  )
);

drop policy if exists "roles delete for org_admin or super_admin" on public.roles;
create policy "roles delete for org_admin or super_admin"
on public.roles
for delete
to authenticated
using (
  (
    public.auth_current_user_has_critical_capability('platform.admin.override')
    and roles.role_kind = 'system'
    and roles.is_baseline = false
  )
  or (
    roles.role_kind = 'custom'
    and roles.owner_organization_id is not null
    and public.auth_user_is_org_admin(roles.owner_organization_id, (select auth.uid()))
  )
);

-- canonical role_permission write policies for custom org roles and
-- system non-baseline roles under critical override.
drop policy if exists "role_permission insert for org_admin or super_admin" on public.role_permission;
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
          public.auth_current_user_has_critical_capability('platform.admin.override')
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

drop policy if exists "role_permission delete for org_admin or super_admin" on public.role_permission;
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
          public.auth_current_user_has_critical_capability('platform.admin.override')
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

drop policy if exists "user_role select for self or super_admin" on public.user_role;
create policy "user_role select for self or super_admin"
on public.user_role
for select
to authenticated
using (
  user_role.user_id = (select auth.uid())
  or public.auth_current_user_has_critical_capability('platform.admin.override')
  or (
    user_role.space_id is not null
    and public.auth_user_active_in_space(user_role.space_id, (select auth.uid()))
  )
);

drop policy if exists "user_role insert for org_admin or super_admin" on public.user_role;
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
  public.auth_current_user_has_critical_capability('platform.admin.override')
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

drop policy if exists "user_role update for org_admin or super_admin" on public.user_role;
create policy "user_role update for org_admin or super_admin"
on public.user_role
for update
to authenticated
using (
  public.auth_current_user_has_critical_capability('platform.admin.override')
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
  public.auth_current_user_has_critical_capability('platform.admin.override')
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

drop policy if exists "user_role delete for org_admin or super_admin" on public.user_role;
create policy "user_role delete for org_admin or super_admin"
on public.user_role
for delete
to authenticated
using (
  public.auth_current_user_has_critical_capability('platform.admin.override')
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
  v_is_critical boolean;
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

  v_is_critical := public.auth_user_has_critical_capability(
    v_uid,
    'platform.admin.override'
  );
  v_is_org_admin := public.auth_user_is_org_admin(v_org_id, v_uid);
  v_is_space_admin := public.auth_user_is_space_admin(p_space_id, v_uid);

  if not (v_is_critical or v_is_org_admin or v_is_space_admin) then
    raise exception 'Not allowed to invite to this space';
  end if;

  if v_selected_role_key = 'space_admin' and not (v_is_critical or v_is_org_admin) then
    raise exception 'Only organization admins can grant space admin';
  end if;

  if v_is_space_admin and not (v_is_critical or v_is_org_admin) and v_selected_role_key <> 'member' then
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

