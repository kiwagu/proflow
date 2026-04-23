/*
 * section 4a delegated domain-user management
 * - remove role-key hardcoding from space_memberships CRUD
 * - align space_memberships select visibility with permission-driven admin actions
 * - enforce permission-driven writes using RBAC permission catalog
 * - make role-catalog and member-role admin mutations transactional via rpc boundaries
 * - no legacy fallbacks
 */

drop policy if exists "space_memberships select for co-members or super_admin" on public.space_memberships;
create policy "space_memberships select for co-members or super_admin"
on public.space_memberships
for select
to authenticated
using (
  public.auth_current_user_has_critical_capability('platform.admin.override')
  or space_memberships.user_id = (select auth.uid())
  or public.auth_user_active_in_space(space_memberships.space_id, (select auth.uid()))
  or public.auth_user_has_permission(
    'space.users.read',
    space_memberships.space_id,
    null::text
  )
);

drop policy if exists "space_memberships insert for org_admin or super_admin" on public.space_memberships;
create policy "space_memberships insert for org_admin or super_admin"
on public.space_memberships
for insert
to authenticated
with check (
  public.auth_current_user_has_critical_capability('platform.admin.override')
  or (
    public.auth_user_has_permission(
      'space.users.create',
      space_memberships.space_id,
      null::text
    )
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
  or public.auth_user_has_permission(
    'space.users.update',
    space_memberships.space_id,
    null::text
  )
)
with check (
  public.auth_current_user_has_critical_capability('platform.admin.override')
  or (
    public.auth_user_has_permission(
      'space.users.update',
      space_memberships.space_id,
      null::text
    )
    and space_memberships.status in ('active', 'invited', 'suspended')
  )
);

drop policy if exists "space_memberships delete for org_admin or super_admin" on public.space_memberships;
create policy "space_memberships delete for org_admin or super_admin"
on public.space_memberships
for delete
to authenticated
using (
  public.auth_current_user_has_critical_capability('platform.admin.override')
  or public.auth_user_has_permission(
    'space.users.delete',
    space_memberships.space_id,
    null::text
  )
);

-- ---------------------------------------------------------------------------
-- transactional rpc boundaries for org-admin ui mutations
-- ---------------------------------------------------------------------------

create or replace function public.role_catalog_audit_snapshot(p_role_id text)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'key', r.key,
    'label', r.label,
    'description', r.description,
    'scope', r.scope,
    'role_kind', r.role_kind,
    'owner_organization_id', r.owner_organization_id,
    'archived_at', r.archived_at,
    'permission_keys', coalesce(
      (
        select jsonb_agg(permission_key order by permission_key)
        from (
          select distinct p.key as permission_key
          from public.role_permission rp
          join public.permissions p
            on p.id = rp.permission_id
          where rp.role_id = r.id
        ) permission_keys
      ),
      '[]'::jsonb
    )
  )
  from public.roles r
  where r.id = p_role_id;
$$;

create or replace function public.space_member_role_audit_snapshot(
  p_space_id text,
  p_target_user_id uuid
)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'target_user_id', p_target_user_id,
    'assigned_role_keys', coalesce(
      (
        select jsonb_agg(role_key order by role_key)
        from (
          select distinct r.key as role_key
          from public.user_role ur
          join public.roles r
            on r.id = ur.role_id
          where ur.space_id = p_space_id
            and ur.user_id = p_target_user_id
            and r.scope = 'space'
            and r.archived_at is null
        ) role_keys
      ),
      '[]'::jsonb
    )
  );
$$;

create or replace function public.rpc_create_organization_custom_role(
  p_organization_id text,
  p_key text,
  p_label text,
  p_description text,
  p_scope text,
  p_permission_keys text[]
)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_role_id text;
  v_permission_keys text[];
  v_expected_permission_count integer;
  v_actual_permission_count integer;
  v_new_value jsonb;
begin
  if v_actor_user_id is null then
    raise exception 'Not authenticated.';
  end if;

  select coalesce(array_agg(distinct trimmed_key order by trimmed_key), '{}'::text[])
    into v_permission_keys
  from (
    select trim(permission_key) as trimmed_key
    from unnest(coalesce(p_permission_keys, '{}'::text[])) as permission_key
    where trim(permission_key) <> ''
  ) normalized_keys;

  v_expected_permission_count := coalesce(array_length(v_permission_keys, 1), 0);
  if v_expected_permission_count = 0 then
    raise exception 'Select at least one permission.';
  end if;

  select count(*)
    into v_actual_permission_count
  from public.permissions
  where key = any(v_permission_keys);

  if v_actual_permission_count <> v_expected_permission_count then
    raise exception 'Unknown permission keys.';
  end if;

  insert into public.roles (
    key,
    label,
    description,
    scope,
    role_kind,
    owner_organization_id,
    is_baseline,
    is_mutable,
    archived_at
  )
  values (
    trim(lower(p_key)),
    trim(p_label),
    nullif(trim(coalesce(p_description, '')), ''),
    p_scope,
    'custom',
    p_organization_id,
    false,
    true,
    null
  )
  returning id into v_role_id;

  insert into public.role_permission (role_id, permission_id)
  select v_role_id, p.id
  from public.permissions p
  where p.key = any(v_permission_keys);

  v_new_value := public.role_catalog_audit_snapshot(v_role_id);

  insert into public.space_admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    organization_id,
    space_id,
    request_id,
    previous_value,
    new_value
  )
  values (
    v_actor_user_id,
    'role.catalog.create',
    'role_catalog',
    v_role_id,
    p_organization_id,
    null,
    null,
    null,
    v_new_value
  );

  return v_role_id;
end;
$$;

create or replace function public.rpc_update_organization_custom_role(
  p_role_id text,
  p_key text,
  p_label text,
  p_description text,
  p_permission_keys text[]
)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_role_row public.roles%rowtype;
  v_permission_keys text[];
  v_expected_permission_count integer;
  v_actual_permission_count integer;
  v_previous_value jsonb;
  v_new_value jsonb;
begin
  if v_actor_user_id is null then
    raise exception 'Not authenticated.';
  end if;

  select *
    into v_role_row
  from public.roles
  where id = p_role_id;

  if not found then
    raise exception 'Role not found.';
  end if;

  if v_role_row.role_kind <> 'custom' or v_role_row.owner_organization_id is null then
    raise exception 'Only custom organization roles are editable.';
  end if;

  if v_role_row.archived_at is not null then
    raise exception 'Archived role cannot be edited.';
  end if;

  select coalesce(array_agg(distinct trimmed_key order by trimmed_key), '{}'::text[])
    into v_permission_keys
  from (
    select trim(permission_key) as trimmed_key
    from unnest(coalesce(p_permission_keys, '{}'::text[])) as permission_key
    where trim(permission_key) <> ''
  ) normalized_keys;

  v_expected_permission_count := coalesce(array_length(v_permission_keys, 1), 0);
  if v_expected_permission_count = 0 then
    raise exception 'Select at least one permission.';
  end if;

  select count(*)
    into v_actual_permission_count
  from public.permissions
  where key = any(v_permission_keys);

  if v_actual_permission_count <> v_expected_permission_count then
    raise exception 'Unknown permission keys.';
  end if;

  v_previous_value := public.role_catalog_audit_snapshot(p_role_id);

  update public.roles
  set key = coalesce(nullif(trim(lower(coalesce(p_key, ''))), ''), key),
      label = coalesce(nullif(trim(coalesce(p_label, '')), ''), label),
      description = case
        when p_description is null then description
        else nullif(trim(p_description), '')
      end
  where id = p_role_id
    and role_kind = 'custom';

  delete from public.role_permission
  where role_id = p_role_id;

  insert into public.role_permission (role_id, permission_id)
  select p_role_id, p.id
  from public.permissions p
  where p.key = any(v_permission_keys);

  v_new_value := public.role_catalog_audit_snapshot(p_role_id);

  insert into public.space_admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    organization_id,
    space_id,
    request_id,
    previous_value,
    new_value
  )
  values (
    v_actor_user_id,
    'role.catalog.update',
    'role_catalog',
    p_role_id,
    v_role_row.owner_organization_id,
    null,
    null,
    v_previous_value,
    v_new_value
  );

  return p_role_id;
end;
$$;

create or replace function public.rpc_archive_organization_custom_role(
  p_role_id text
)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_role_row public.roles%rowtype;
  v_previous_value jsonb;
  v_new_value jsonb;
begin
  if v_actor_user_id is null then
    raise exception 'Not authenticated.';
  end if;

  select *
    into v_role_row
  from public.roles
  where id = p_role_id;

  if not found then
    raise exception 'Role not found.';
  end if;

  if v_role_row.role_kind <> 'custom' or v_role_row.owner_organization_id is null then
    raise exception 'Only custom organization roles can be archived.';
  end if;

  v_previous_value := public.role_catalog_audit_snapshot(p_role_id);

  update public.roles
  set archived_at = timezone('utc', now())
  where id = p_role_id
    and archived_at is null;

  v_new_value := public.role_catalog_audit_snapshot(p_role_id);

  insert into public.space_admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    organization_id,
    space_id,
    request_id,
    previous_value,
    new_value
  )
  values (
    v_actor_user_id,
    'role.catalog.archive',
    'role_catalog',
    p_role_id,
    v_role_row.owner_organization_id,
    null,
    null,
    v_previous_value,
    v_new_value
  );

  return p_role_id;
end;
$$;

create or replace function public.rpc_set_space_member_role(
  p_space_id text,
  p_target_user_id uuid,
  p_role_key text
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_organization_id text;
  v_role_id text;
  v_previous_value jsonb;
  v_new_value jsonb;
begin
  if v_actor_user_id is null then
    raise exception 'Not authenticated.';
  end if;

  select organization_id
    into v_organization_id
  from public.spaces
  where id = p_space_id;

  if v_organization_id is null then
    raise exception 'Space not found.';
  end if;

  if not exists (
    select 1
    from public.space_memberships
    where space_id = p_space_id
      and user_id = p_target_user_id
      and status = 'active'
  ) then
    raise exception 'User is not an active member of this Space.';
  end if;

  select r.id
    into v_role_id
  from public.roles r
  where r.scope = 'space'
    and r.key = trim(p_role_key)
    and r.archived_at is null
    and (
      r.owner_organization_id = v_organization_id
      or r.owner_organization_id is null
    )
  order by case when r.owner_organization_id = v_organization_id then 0 else 1 end
  limit 1;

  if v_role_id is null then
    raise exception 'Role not found for this Space.';
  end if;

  v_previous_value := public.space_member_role_audit_snapshot(
    p_space_id,
    p_target_user_id
  );

  delete from public.user_role
  where user_id = p_target_user_id
    and space_id = p_space_id;

  insert into public.user_role (
    user_id,
    role_id,
    space_id,
    organization_id
  )
  values (
    p_target_user_id,
    v_role_id,
    p_space_id,
    null
  );

  v_new_value := public.space_member_role_audit_snapshot(
    p_space_id,
    p_target_user_id
  );

  insert into public.space_admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    organization_id,
    space_id,
    request_id,
    previous_value,
    new_value
  )
  values (
    v_actor_user_id,
    'space.member_role.set',
    'space_member_role',
    p_target_user_id::text,
    v_organization_id,
    p_space_id,
    null,
    v_previous_value,
    v_new_value
  );

  return true;
end;
$$;

revoke all on function public.role_catalog_audit_snapshot(text) from public;
revoke all on function public.space_member_role_audit_snapshot(text, uuid) from public;
revoke all on function public.rpc_create_organization_custom_role(text, text, text, text, text, text[]) from public;
revoke all on function public.rpc_update_organization_custom_role(text, text, text, text, text[]) from public;
revoke all on function public.rpc_archive_organization_custom_role(text) from public;
revoke all on function public.rpc_set_space_member_role(text, uuid, text) from public;

grant execute on function public.role_catalog_audit_snapshot(text) to authenticated;
grant execute on function public.space_member_role_audit_snapshot(text, uuid) to authenticated;
grant execute on function public.rpc_create_organization_custom_role(text, text, text, text, text, text[]) to authenticated;
grant execute on function public.rpc_update_organization_custom_role(text, text, text, text, text[]) to authenticated;
grant execute on function public.rpc_archive_organization_custom_role(text) to authenticated;
grant execute on function public.rpc_set_space_member_role(text, uuid, text) to authenticated;
