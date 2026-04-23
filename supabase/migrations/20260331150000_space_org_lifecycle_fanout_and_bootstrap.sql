/*
 * Space/org lifecycle: Postgres -> Edge space_org_lifecycle_fanout -> JetStream (Author mirror).
 * Reuses identity_sync.outbound_config.internal_secret (same as identity_lifecycle_fanout).
 * Add space_org_edge_fanout_url for the second Edge function URL.
 *
 * rpc_bootstrap_organization_and_space: greenfield onboarding (one org per user) without broad INSERT on organizations.
 */

alter table identity_sync.outbound_config
  add column if not exists space_org_edge_fanout_url text not null default 'http://kong:8000/functions/v1/space_org_lifecycle_fanout';

comment on column identity_sync.outbound_config.space_org_edge_fanout_url is
  'Edge function URL for organization/space/membership lifecycle fan-out (same internal_secret as identity).';

-- ---------------------------------------------------------------------------
-- space_org_sync: trigger helpers (same pattern as identity_sync)
-- ---------------------------------------------------------------------------
create schema if not exists space_org_sync;

revoke all on schema space_org_sync from public;
grant usage on schema space_org_sync to postgres;

create or replace function space_org_sync.notify_organization_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg record;
  req_body jsonb;
  req_headers jsonb;
begin
  select c.space_org_edge_fanout_url, c.internal_secret
  into cfg
  from identity_sync.outbound_config as c
  where c.id = 1;

  if cfg is null or cfg.internal_secret is null or cfg.internal_secret = '' then
    raise warning
      'space_org_sync: organization fan-out skipped (set identity_sync.outbound_config.internal_secret)';
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    req_body := jsonb_build_object(
      'event', 'organization.created',
      'organization', jsonb_build_object(
        'id', new.id,
        'name', new.name,
        'slug', new.slug,
        'parent_organization_id', new.parent_organization_id
      )
    );
  elsif tg_op = 'UPDATE' then
    req_body := jsonb_build_object(
      'event', 'organization.updated',
      'organization', jsonb_build_object(
        'id', new.id,
        'name', new.name,
        'slug', new.slug,
        'parent_organization_id', new.parent_organization_id
      )
    );
  else
    req_body := jsonb_build_object(
      'event', 'organization.deleted',
      'organization', jsonb_build_object('id', old.id)
    );
  end if;

  req_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'X-Identity-Internal-Secret', cfg.internal_secret
  );

  perform net.http_post(
    cfg.space_org_edge_fanout_url,
    req_body,
    '{}'::jsonb,
    req_headers,
    8000
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

alter function space_org_sync.notify_organization_row() owner to postgres;

drop trigger if exists on_organization_row_space_org_fanout on public.organizations;
create trigger on_organization_row_space_org_fanout
after insert or update or delete on public.organizations
for each row
execute function space_org_sync.notify_organization_row();

create or replace function space_org_sync.notify_space_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg record;
  req_body jsonb;
  req_headers jsonb;
begin
  select c.space_org_edge_fanout_url, c.internal_secret
  into cfg
  from identity_sync.outbound_config as c
  where c.id = 1;

  if cfg is null or cfg.internal_secret is null or cfg.internal_secret = '' then
    raise warning
      'space_org_sync: space fan-out skipped (set identity_sync.outbound_config.internal_secret)';
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    req_body := jsonb_build_object(
      'event', 'space.created',
      'space', jsonb_build_object(
        'id', new.id,
        'organization_id', new.organization_id,
        'name', new.name,
        'slug', new.slug
      )
    );
  elsif tg_op = 'UPDATE' then
    req_body := jsonb_build_object(
      'event', 'space.updated',
      'space', jsonb_build_object(
        'id', new.id,
        'organization_id', new.organization_id,
        'name', new.name,
        'slug', new.slug
      )
    );
  else
    req_body := jsonb_build_object(
      'event', 'space.deleted',
      'space', jsonb_build_object(
        'id', old.id,
        'organization_id', old.organization_id
      )
    );
  end if;

  req_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'X-Identity-Internal-Secret', cfg.internal_secret
  );

  perform net.http_post(
    cfg.space_org_edge_fanout_url,
    req_body,
    '{}'::jsonb,
    req_headers,
    8000
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

alter function space_org_sync.notify_space_row() owner to postgres;

drop trigger if exists on_space_row_space_org_fanout on public.spaces;
create trigger on_space_row_space_org_fanout
after insert or update or delete on public.spaces
for each row
execute function space_org_sync.notify_space_row();

create or replace function space_org_sync.notify_space_membership_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg record;
  req_body jsonb;
  req_headers jsonb;
begin
  select c.space_org_edge_fanout_url, c.internal_secret
  into cfg
  from identity_sync.outbound_config as c
  where c.id = 1;

  if cfg is null or cfg.internal_secret is null or cfg.internal_secret = '' then
    raise warning
      'space_org_sync: membership fan-out skipped (set identity_sync.outbound_config.internal_secret)';
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    req_body := jsonb_build_object(
      'event', 'space_membership.created',
      'membership', jsonb_build_object(
        'space_id', new.space_id,
        'user_id', new.user_id::text,
        'status', new.status
      )
    );
  elsif tg_op = 'UPDATE' then
    req_body := jsonb_build_object(
      'event', 'space_membership.updated',
      'membership', jsonb_build_object(
        'space_id', new.space_id,
        'user_id', new.user_id::text,
        'status', new.status
      )
    );
  else
    req_body := jsonb_build_object(
      'event', 'space_membership.deleted',
      'membership', jsonb_build_object(
        'space_id', old.space_id,
        'user_id', old.user_id::text
      )
    );
  end if;

  req_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'X-Identity-Internal-Secret', cfg.internal_secret
  );

  perform net.http_post(
    cfg.space_org_edge_fanout_url,
    req_body,
    '{}'::jsonb,
    req_headers,
    8000
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

alter function space_org_sync.notify_space_membership_row() owner to postgres;

drop trigger if exists on_space_membership_row_space_org_fanout on public.space_memberships;
create trigger on_space_membership_row_space_org_fanout
after insert or update or delete on public.space_memberships
for each row
execute function space_org_sync.notify_space_membership_row();

-- ---------------------------------------------------------------------------
-- Bootstrap: one organization + org_admin + one space + active membership (authenticated user)
-- ---------------------------------------------------------------------------
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

  insert into public.organizations (name, slug)
  values (p_org_name, p_org_slug)
  returning id into v_org_id;

  insert into public.organization_memberships (organization_id, user_id, role)
  values (v_org_id, v_uid, 'org_admin');

  insert into public.spaces (organization_id, name, slug)
  values (v_org_id, p_space_name, p_space_slug)
  returning id into v_space_id;

  insert into public.space_memberships (space_id, user_id, status, role)
  values (v_space_id, v_uid, 'active', 'admin');

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

comment on function public.rpc_bootstrap_organization_and_space(text, text, text, text, text) is
  'Creates first organization, org_admin membership, space, and active space membership for the current user.';

alter function public.rpc_bootstrap_organization_and_space(text, text, text, text, text) owner to postgres;

grant execute on function public.rpc_bootstrap_organization_and_space(text, text, text, text, text) to authenticated;

-- organizations: org_admin may update own org
drop policy if exists "organizations update for org_admin" on public.organizations;
create policy "organizations update for org_admin"
on public.organizations
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = organizations.id
      and om.user_id = (select auth.uid())
      and om.role = 'org_admin'
  )
)
with check (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = organizations.id
      and om.user_id = (select auth.uid())
      and om.role = 'org_admin'
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
