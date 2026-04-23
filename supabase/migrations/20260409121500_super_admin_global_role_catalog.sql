/*
 * section 4b super-admin global system-role management
 * - dedicated transactional rpc boundaries for non-baseline global system roles
 * - critical-capability gated, auditable, no compatibility shims
 */

create or replace function public.rpc_create_global_system_role(
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
  v_role_id text;
  v_permission_keys text[];
  v_expected_permission_count integer;
  v_actual_permission_count integer;
  v_new_value jsonb;
begin
  if v_actor_user_id is null then
    raise exception 'Not authenticated.';
  end if;

  if not public.auth_current_user_has_critical_capability('platform.admin.override') then
    raise exception 'Not allowed to manage global system roles.';
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
    'global',
    'system',
    null,
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
    'role.catalog.global.create',
    'global_role_catalog',
    v_role_id,
    null,
    null,
    null,
    null,
    v_new_value
  );

  return v_role_id;
end;
$$;

create or replace function public.rpc_update_global_system_role(
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

  if not public.auth_current_user_has_critical_capability('platform.admin.override') then
    raise exception 'Not allowed to manage global system roles.';
  end if;

  select *
    into v_role_row
  from public.roles
  where id = p_role_id;

  if not found then
    raise exception 'Role not found.';
  end if;

  if v_role_row.role_kind <> 'system'
    or v_role_row.scope <> 'global'
    or v_role_row.owner_organization_id is not null
    or v_role_row.is_baseline then
    raise exception 'Only non-baseline global system roles are editable.';
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
    and role_kind = 'system'
    and scope = 'global';

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
    'role.catalog.global.update',
    'global_role_catalog',
    p_role_id,
    null,
    null,
    null,
    v_previous_value,
    v_new_value
  );

  return p_role_id;
end;
$$;

create or replace function public.rpc_archive_global_system_role(
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

  if not public.auth_current_user_has_critical_capability('platform.admin.override') then
    raise exception 'Not allowed to manage global system roles.';
  end if;

  select *
    into v_role_row
  from public.roles
  where id = p_role_id;

  if not found then
    raise exception 'Role not found.';
  end if;

  if v_role_row.role_kind <> 'system'
    or v_role_row.scope <> 'global'
    or v_role_row.owner_organization_id is not null
    or v_role_row.is_baseline then
    raise exception 'Only non-baseline global system roles can be archived.';
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
    'role.catalog.global.archive',
    'global_role_catalog',
    p_role_id,
    null,
    null,
    null,
    v_previous_value,
    v_new_value
  );

  return p_role_id;
end;
$$;