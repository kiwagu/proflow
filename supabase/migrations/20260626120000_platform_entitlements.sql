-- Platform entitlements — ADR-0022.
--
-- Commercial, plan-gated capabilities ride the EXISTING scope-aware
-- runtime-settings / feature-flag machinery, under a distinct
-- `platform.entitlement.*` key namespace. This migration does two things and
-- adds NO new storage table (entitlement values live in `runtime_settings`):
--
--   1. Widen the write-RPC key-guard so `rpc_set_platform_feature_flag` accepts
--      BOTH `platform.feature_flag.%` and `platform.entitlement.%` keys. The
--      audit-log action label stays `feature_flag.upsert` (an entitlement write
--      rides the same RPC/table and is distinguishable by its `platform.entitlement.*`
--      key in the payload) — keeping the established audit contract stable.
--
--   2. Add a SECURITY DEFINER read-RPC `rpc_resolve_platform_flag` that resolves
--      a flag/entitlement with the global→org→space hierarchy and org∧space
--      AND-composition IN SQL — mirroring
--      `apps/platform/lib/runtime-settings.server.ts:296-403`. It is
--      `grant execute to authenticated`, so BOTH the platform and author apps
--      resolve the boolean by calling it under the USER'S RLS client — zero
--      service-role on the read path. The function returns only a boolean
--      (non-sensitive plan state); it is ungated on membership for v1.

-- 1. Widen the write-RPC key-guard + generalise the audit label.
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

  -- Accept platform feature-flag AND entitlement keys; reject any other prefix.
  if v_key not like 'platform.feature_flag.%'
     and v_key not like 'platform.entitlement.%' then
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

-- 2. Hierarchical read-RPC — global→org→space with org∧space AND-composition.
create or replace function public.rpc_resolve_platform_flag(
  p_key text,
  p_space_id text default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text := trim(coalesce(p_key, ''));
  v_space_id text := nullif(trim(coalesce(p_space_id, '')), '');
  v_organization_id text;
  v_global boolean;
  v_org boolean;
  v_space boolean;
begin
  if v_key = '' then
    return false;
  end if;

  -- Resolve platform feature-flag AND entitlement keys only; fail closed otherwise.
  if v_key not like 'platform.feature_flag.%'
     and v_key not like 'platform.entitlement.%' then
    return false;
  end if;

  select rs.value = to_jsonb(true)
    into v_global
  from public.runtime_settings rs
  where rs.scope = 'global'
    and rs.key = v_key
    and rs.scope_target = '__global__'
  limit 1;
  v_global := coalesce(v_global, false);

  -- No space context → the global default is the effective value.
  if v_space_id is null then
    return v_global;
  end if;

  select s.organization_id
    into v_organization_id
  from public.spaces s
  where s.id = v_space_id;

  -- Unknown space → fail closed.
  if v_organization_id is null then
    return false;
  end if;

  select rs.value = to_jsonb(true)
    into v_org
  from public.runtime_settings rs
  where rs.scope = 'organization'
    and rs.key = v_key
    and rs.scope_target = v_organization_id
  limit 1;
  v_org := coalesce(v_org, false);

  select rs.value = to_jsonb(true)
    into v_space
  from public.runtime_settings rs
  where rs.scope = 'space'
    and rs.key = v_key
    and rs.scope_target = v_space_id
  limit 1;
  v_space := coalesce(v_space, false);

  -- A space's plan can never exceed its org's plan.
  return v_org and v_space;
end;
$$;

revoke all on function public.rpc_resolve_platform_flag(text, text) from public;
grant execute on function public.rpc_resolve_platform_flag(text, text) to authenticated;
