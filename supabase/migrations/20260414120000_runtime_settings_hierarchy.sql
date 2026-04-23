/*
 * runtime settings hierarchy
 * - generic scope-aware store for global -> organization -> space -> user overrides
 * - public rows can participate in runtime resolution for authenticated members
 * - writes flow through audited rpc entrypoints
 */

create table public.runtime_settings (
  id text primary key default public.entity_id_generate('rts'),
  scope text not null check (scope in ('global', 'organization', 'space', 'user')),
  scope_id text,
  scope_target text generated always as (coalesce(scope_id, '__global__')) stored,
  key text not null,
  value jsonb not null,
  value_type text not null check (value_type in ('string', 'boolean', 'number', 'json')),
  is_public boolean not null default false,
  created_by_user_id uuid references auth.users (id) on delete set null,
  updated_by_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint runtime_settings_scope_scope_id_chk check (
    (scope = 'global' and scope_id is null)
    or (scope <> 'global' and scope_id is not null)
  ),
  constraint runtime_settings_value_matches_type_chk check (
    value_type = 'json'
    or (value_type = 'string' and jsonb_typeof(value) = 'string')
    or (value_type = 'boolean' and jsonb_typeof(value) = 'boolean')
    or (value_type = 'number' and jsonb_typeof(value) = 'number')
  ),
  constraint runtime_settings_scope_key_scope_target_key unique (scope, key, scope_target)
);

comment on table public.runtime_settings is
  'Scope-aware runtime configuration overrides. Resolution order is user -> space -> organization -> global.';

comment on column public.runtime_settings.scope is
  'Override level: global, organization, space, or user.';

comment on column public.runtime_settings.scope_id is
  'Target id for non-global scopes. Uses organization/space entity ids and auth.users uuid text for user scope.';

comment on column public.runtime_settings.key is
  'Stable runtime setting key, for example platform.locale or runtime.log_level.';

comment on column public.runtime_settings.value is
  'JSONB payload for the setting value; exact type is constrained by value_type.';

comment on column public.runtime_settings.is_public is
  'Whether authenticated readers in the relevant scope may resolve this setting without elevated admin access.';

create index runtime_settings_scope_scope_id_idx
  on public.runtime_settings (scope, scope_id);

create index runtime_settings_key_scope_idx
  on public.runtime_settings (key, scope, scope_id);

create or replace function public.set_runtime_settings_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists runtime_settings_set_updated_at on public.runtime_settings;
create trigger runtime_settings_set_updated_at
before update on public.runtime_settings
for each row
execute function public.set_runtime_settings_updated_at();

create or replace function public.delete_runtime_settings_for_organization()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  delete from public.runtime_settings
  where scope = 'organization'
    and scope_id = old.id;

  return old;
end;
$$;

drop trigger if exists organizations_delete_runtime_settings on public.organizations;
create trigger organizations_delete_runtime_settings
before delete on public.organizations
for each row
execute function public.delete_runtime_settings_for_organization();

create or replace function public.delete_runtime_settings_for_space()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  delete from public.runtime_settings
  where scope = 'space'
    and scope_id = old.id;

  return old;
end;
$$;

drop trigger if exists spaces_delete_runtime_settings on public.spaces;
create trigger spaces_delete_runtime_settings
before delete on public.spaces
for each row
execute function public.delete_runtime_settings_for_space();

create or replace function public.runtime_settings_actor_can_manage_scope(
  p_scope text,
  p_scope_id text default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_scope text := lower(trim(coalesce(p_scope, '')));
  v_scope_id text := nullif(trim(coalesce(p_scope_id, '')), '');
  v_organization_id text;
begin
  if v_user_id is null then
    return false;
  end if;

  if public.auth_current_user_has_critical_capability('platform.admin.override') then
    return true;
  end if;

  if v_scope = 'global' then
    return public.auth_current_user_has_critical_capability('platform.admin.override');
  end if;

  if v_scope = 'organization' then
    return v_scope_id is not null
      and public.auth_user_is_org_admin(v_scope_id, v_user_id);
  end if;

  if v_scope = 'space' then
    if v_scope_id is null then
      return false;
    end if;

    select s.organization_id
      into v_organization_id
    from public.spaces s
    where s.id = v_scope_id;

    return public.auth_user_is_space_admin(v_scope_id, v_user_id)
      or (
        v_organization_id is not null
        and public.auth_user_is_org_admin(v_organization_id, v_user_id)
      );
  end if;

  if v_scope = 'user' then
    return v_scope_id = v_user_id::text;
  end if;

  return false;
end;
$$;

revoke all on function public.runtime_settings_actor_can_manage_scope(text, text) from public;
grant execute on function public.runtime_settings_actor_can_manage_scope(text, text) to authenticated;

create or replace function public.platform_feature_flag_actor_can_manage_scope(
  p_scope text,
  p_scope_id text default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_scope text := lower(trim(coalesce(p_scope, '')));
  v_scope_id text := nullif(trim(coalesce(p_scope_id, '')), '');
  v_organization_id text;
begin
  if v_user_id is null then
    return false;
  end if;

  if public.auth_current_user_has_critical_capability('platform.admin.override') then
    return true;
  end if;

  if v_scope = 'global' then
    return false;
  end if;

  if v_scope = 'organization' then
    return v_scope_id is not null
      and public.auth_user_is_org_admin(v_scope_id, v_user_id);
  end if;

  if v_scope = 'space' then
    if v_scope_id is null then
      return false;
    end if;

    select s.organization_id
      into v_organization_id
    from public.spaces s
    where s.id = v_scope_id;

    return v_organization_id is not null
      and public.auth_user_is_org_admin(v_organization_id, v_user_id);
  end if;

  return false;
end;
$$;

revoke all on function public.platform_feature_flag_actor_can_manage_scope(text, text) from public;
grant execute on function public.platform_feature_flag_actor_can_manage_scope(text, text) to authenticated;

create or replace function public.runtime_settings_actor_can_read_scope(
  p_scope text,
  p_scope_id text default null,
  p_is_public boolean default false
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_scope text := lower(trim(coalesce(p_scope, '')));
  v_scope_id text := nullif(trim(coalesce(p_scope_id, '')), '');
begin
  if public.runtime_settings_actor_can_manage_scope(v_scope, v_scope_id) then
    return true;
  end if;

  if not coalesce(p_is_public, false) then
    return false;
  end if;

  if v_scope = 'global' then
    return true;
  end if;

  if v_user_id is null then
    return false;
  end if;

  if v_scope = 'organization' then
    return public.auth_user_member_of_org(v_scope_id, v_user_id)
      or exists (
        select 1
        from public.spaces s
        where s.organization_id = v_scope_id
          and public.auth_user_active_in_space(s.id, v_user_id)
      );
  end if;

  if v_scope = 'space' then
    return public.auth_user_active_in_space(v_scope_id, v_user_id);
  end if;

  if v_scope = 'user' then
    return v_scope_id = v_user_id::text;
  end if;

  return false;
end;
$$;

revoke all on function public.runtime_settings_actor_can_read_scope(text, text, boolean) from public;
grant execute on function public.runtime_settings_actor_can_read_scope(text, text, boolean) to authenticated;

alter table public.runtime_settings enable row level security;

create policy runtime_settings_select
  on public.runtime_settings
  for select
  to authenticated
  using (
    public.runtime_settings_actor_can_read_scope(scope, scope_id, is_public)
  );

grant select on public.runtime_settings to authenticated;

create or replace function public.rpc_set_platform_feature_flag(
  p_scope text,
  p_scope_id text default null,
  p_key text default null,
  p_enabled boolean default null,
  p_request_id text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_scope text := lower(trim(coalesce(p_scope, '')));
  v_scope_id text := nullif(trim(coalesce(p_scope_id, '')), '');
  v_key text := trim(coalesce(p_key, ''));
  v_setting_id text;
  v_organization_id text;
  v_previous public.runtime_settings%rowtype;
  v_previous_payload jsonb := null;
  v_new_payload jsonb;
begin
  if v_actor_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if v_scope not in ('global', 'organization', 'space') then
    raise exception 'Invalid feature flag scope';
  end if;

  if v_key = '' then
    raise exception 'Feature flag key is required';
  end if;

  if v_key not like 'platform.feature_flag.%' then
    raise exception 'Invalid feature flag key';
  end if;

  if p_enabled is null then
    raise exception 'Feature flag value is required';
  end if;

  if v_scope = 'global' and v_scope_id is not null then
    raise exception 'Global feature flags cannot target a scope id';
  end if;

  if v_scope <> 'global' and v_scope_id is null then
    raise exception 'Scope id is required for non-global feature flags';
  end if;

  if v_scope = 'organization' then
    if not exists (
      select 1
      from public.organizations o
      where o.id = v_scope_id
    ) then
      raise exception 'Organization feature flag target not found';
    end if;
    v_organization_id := v_scope_id;
  elsif v_scope = 'space' then
    select s.organization_id
      into v_organization_id
    from public.spaces s
    where s.id = v_scope_id;

    if v_organization_id is null then
      raise exception 'Space feature flag target not found';
    end if;
  end if;

  if not public.platform_feature_flag_actor_can_manage_scope(v_scope, v_scope_id) then
    raise exception 'Not allowed to write feature flags for this scope';
  end if;

  select rs.*
    into v_previous
  from public.runtime_settings rs
  where rs.scope = v_scope
    and rs.key = v_key
    and rs.scope_target = coalesce(v_scope_id, '__global__')
  limit 1;

  if found then
    v_previous_payload := jsonb_build_object(
      'scope', v_previous.scope,
      'scope_id', v_previous.scope_id,
      'key', v_previous.key,
      'value', v_previous.value,
      'value_type', v_previous.value_type,
      'is_public', v_previous.is_public
    );
  end if;

  insert into public.runtime_settings (
    scope,
    scope_id,
    key,
    value,
    value_type,
    is_public,
    created_by_user_id,
    updated_by_user_id
  )
  values (
    v_scope,
    v_scope_id,
    v_key,
    to_jsonb(p_enabled),
    'boolean',
    false,
    v_actor_user_id,
    v_actor_user_id
  )
  on conflict on constraint runtime_settings_scope_key_scope_target_key
  do update set
    value = excluded.value,
    value_type = excluded.value_type,
    is_public = excluded.is_public,
    updated_by_user_id = excluded.updated_by_user_id,
    updated_at = timezone('utc', now())
  returning id into v_setting_id;

  v_new_payload := jsonb_build_object(
    'scope', v_scope,
    'scope_id', v_scope_id,
    'key', v_key,
    'value', to_jsonb(p_enabled),
    'value_type', 'boolean',
    'is_public', false
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
    'feature_flag.upsert',
    'feature_flag',
    v_setting_id,
    v_organization_id,
    case when v_scope = 'space' then v_scope_id else null end,
    nullif(trim(coalesce(p_request_id, '')), ''),
    v_previous_payload,
    v_new_payload
  );

  return v_setting_id;
end;
$$;

revoke all on function public.rpc_set_platform_feature_flag(text, text, text, boolean, text) from public;
grant execute on function public.rpc_set_platform_feature_flag(text, text, text, boolean, text) to authenticated;

create or replace function public.rpc_set_runtime_setting(
  p_scope text,
  p_scope_id text default null,
  p_key text default null,
  p_value jsonb default null,
  p_value_type text default null,
  p_is_public boolean default false,
  p_request_id text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_scope text := lower(trim(coalesce(p_scope, '')));
  v_scope_id text := nullif(trim(coalesce(p_scope_id, '')), '');
  v_key text := trim(coalesce(p_key, ''));
  v_value_type text := lower(trim(coalesce(p_value_type, '')));
  v_setting_id text;
  v_organization_id text;
  v_previous public.runtime_settings%rowtype;
  v_previous_payload jsonb := null;
  v_new_payload jsonb;
  v_target_user_id uuid;
begin
  if v_actor_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if v_scope not in ('global', 'organization', 'space', 'user') then
    raise exception 'Invalid runtime setting scope';
  end if;

  if v_key = '' then
    raise exception 'Runtime setting key is required';
  end if;

  if v_key like 'platform.feature_flag.%' then
    raise exception 'Feature flags use the dedicated feature-flag mutation entrypoint';
  end if;

  if p_value is null then
    raise exception 'Runtime setting value is required';
  end if;

  if v_value_type not in ('string', 'boolean', 'number', 'json') then
    raise exception 'Invalid runtime setting value type';
  end if;

  if v_scope = 'global' and v_scope_id is not null then
    raise exception 'Global runtime settings cannot target a scope id';
  end if;

  if v_scope <> 'global' and v_scope_id is null then
    raise exception 'Scope id is required for non-global runtime settings';
  end if;

  if v_scope = 'organization' then
    if not exists (
      select 1
      from public.organizations o
      where o.id = v_scope_id
    ) then
      raise exception 'Organization runtime setting target not found';
    end if;
    v_organization_id := v_scope_id;
  elsif v_scope = 'space' then
    select s.organization_id
      into v_organization_id
    from public.spaces s
    where s.id = v_scope_id;

    if v_organization_id is null then
      raise exception 'Space runtime setting target not found';
    end if;
  elsif v_scope = 'user' then
    begin
      v_target_user_id := v_scope_id::uuid;
    exception
      when invalid_text_representation then
        raise exception 'User runtime setting scope id must be a valid uuid';
    end;

    if not exists (
      select 1
      from auth.users u
      where u.id = v_target_user_id
    ) then
      raise exception 'User runtime setting target not found';
    end if;
  end if;

  if not public.runtime_settings_actor_can_manage_scope(v_scope, v_scope_id) then
    raise exception 'Not allowed to write runtime settings for this scope';
  end if;

  select rs.*
    into v_previous
  from public.runtime_settings rs
  where rs.scope = v_scope
    and rs.key = v_key
    and rs.scope_target = coalesce(v_scope_id, '__global__')
  limit 1;

  if found then
    v_previous_payload := jsonb_build_object(
      'scope', v_previous.scope,
      'scope_id', v_previous.scope_id,
      'key', v_previous.key,
      'value', v_previous.value,
      'value_type', v_previous.value_type,
      'is_public', v_previous.is_public
    );
  end if;

  insert into public.runtime_settings (
    scope,
    scope_id,
    key,
    value,
    value_type,
    is_public,
    created_by_user_id,
    updated_by_user_id
  )
  values (
    v_scope,
    v_scope_id,
    v_key,
    p_value,
    v_value_type,
    coalesce(p_is_public, false),
    v_actor_user_id,
    v_actor_user_id
  )
  on conflict on constraint runtime_settings_scope_key_scope_target_key
  do update set
    value = excluded.value,
    value_type = excluded.value_type,
    is_public = excluded.is_public,
    updated_by_user_id = excluded.updated_by_user_id,
    updated_at = timezone('utc', now())
  returning id into v_setting_id;

  v_new_payload := jsonb_build_object(
    'scope', v_scope,
    'scope_id', v_scope_id,
    'key', v_key,
    'value', p_value,
    'value_type', v_value_type,
    'is_public', coalesce(p_is_public, false)
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
    'settings.runtime.upsert',
    'runtime_setting',
    v_setting_id,
    v_organization_id,
    case when v_scope = 'space' then v_scope_id else null end,
    nullif(trim(coalesce(p_request_id, '')), ''),
    v_previous_payload,
    v_new_payload
  );

  return v_setting_id;
end;
$$;

revoke all on function public.rpc_set_runtime_setting(text, text, text, jsonb, text, boolean, text) from public;
grant execute on function public.rpc_set_runtime_setting(text, text, text, jsonb, text, boolean, text) to authenticated;

create or replace function public.rpc_delete_runtime_setting(
  p_scope text,
  p_scope_id text default null,
  p_key text default null,
  p_request_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_scope text := lower(trim(coalesce(p_scope, '')));
  v_scope_id text := nullif(trim(coalesce(p_scope_id, '')), '');
  v_key text := trim(coalesce(p_key, ''));
  v_setting public.runtime_settings%rowtype;
  v_organization_id text;
begin
  if v_actor_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if v_scope not in ('global', 'organization', 'space', 'user') then
    raise exception 'Invalid runtime setting scope';
  end if;

  if v_key = '' then
    raise exception 'Runtime setting key is required';
  end if;

  if v_key like 'platform.feature_flag.%' then
    raise exception 'Feature flags use the dedicated feature-flag mutation entrypoint';
  end if;

  if v_scope = 'global' and v_scope_id is not null then
    raise exception 'Global runtime settings cannot target a scope id';
  end if;

  if v_scope <> 'global' and v_scope_id is null then
    raise exception 'Scope id is required for non-global runtime settings';
  end if;

  if not public.runtime_settings_actor_can_manage_scope(v_scope, v_scope_id) then
    raise exception 'Not allowed to delete runtime settings for this scope';
  end if;

  select rs.*
    into v_setting
  from public.runtime_settings rs
  where rs.scope = v_scope
    and rs.key = v_key
    and rs.scope_target = coalesce(v_scope_id, '__global__')
  limit 1;

  if not found then
    return false;
  end if;

  if v_scope = 'organization' then
    v_organization_id := v_scope_id;
  elsif v_scope = 'space' then
    select s.organization_id
      into v_organization_id
    from public.spaces s
    where s.id = v_scope_id;
  end if;

  delete from public.runtime_settings
  where id = v_setting.id;

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
    'settings.runtime.delete',
    'runtime_setting',
    v_setting.id,
    v_organization_id,
    case when v_scope = 'space' then v_scope_id else null end,
    nullif(trim(coalesce(p_request_id, '')), ''),
    jsonb_build_object(
      'scope', v_setting.scope,
      'scope_id', v_setting.scope_id,
      'key', v_setting.key,
      'value', v_setting.value,
      'value_type', v_setting.value_type,
      'is_public', v_setting.is_public
    ),
    null
  );

  return true;
end;
$$;

revoke all on function public.rpc_delete_runtime_setting(text, text, text, text) from public;
grant execute on function public.rpc_delete_runtime_setting(text, text, text, text) to authenticated;

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
  v_organization_settings_template boolean := false;
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

  select case
      when jsonb_typeof(rs.value) = 'boolean' then (rs.value #>> '{}')::boolean
      else null
    end
    into v_organization_settings_template
  from public.runtime_settings rs
  where rs.scope = 'global'
    and rs.scope_id is null
    and rs.key = 'platform.feature_flag.organization_settings'
  limit 1;

  v_organization_settings_template := coalesce(v_organization_settings_template, false);

  insert into public.organizations (name, slug)
  values (p_org_name, p_org_slug)
  returning id into v_org_id;

  insert into public.runtime_settings (
    scope,
    scope_id,
    key,
    value,
    value_type,
    is_public,
    created_by_user_id,
    updated_by_user_id
  )
  values (
    'organization',
    v_org_id,
    'platform.feature_flag.organization_settings',
    to_jsonb(v_organization_settings_template),
    'boolean',
    false,
    v_uid,
    v_uid
  );

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
