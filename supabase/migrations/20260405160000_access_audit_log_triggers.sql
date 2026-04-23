/*
 * section 4 unified model: access audit hooks
 * - extends space_admin_audit_log with before/after payloads
 * - enforces append-only immutability while allowing FK nullification
 * - emits audit rows for membership, role, and ownership-link changes
 * - consolidated version; later audit follow-up patches are folded here
 */

alter table public.space_admin_audit_log
  add column if not exists previous_value jsonb,
  add column if not exists new_value jsonb;

comment on column public.space_admin_audit_log.previous_value is
  'Optional before-state payload for access and ownership mutations.';

comment on column public.space_admin_audit_log.new_value is
  'Optional after-state payload for access and ownership mutations.';

create index if not exists space_admin_audit_log_entity_created_idx
  on public.space_admin_audit_log (entity_type, entity_id, created_at desc);

create or replace function public.space_admin_audit_log_prevent_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and new.id is not distinct from old.id
    and new.action is not distinct from old.action
    and new.entity_type is not distinct from old.entity_type
    and new.entity_id is not distinct from old.entity_id
    and new.request_id is not distinct from old.request_id
    and new.created_at is not distinct from old.created_at
    and new.previous_value is not distinct from old.previous_value
    and new.new_value is not distinct from old.new_value
    and (
      new.actor_user_id is not distinct from old.actor_user_id
      or (old.actor_user_id is not null and new.actor_user_id is null)
    )
    and (
      new.organization_id is not distinct from old.organization_id
      or (old.organization_id is not null and new.organization_id is null)
    )
    and (
      new.space_id is not distinct from old.space_id
      or (old.space_id is not null and new.space_id is null)
    ) then
    return new;
  end if;

  raise exception 'space_admin_audit_log is append-only';
end;
$$;

drop trigger if exists space_admin_audit_log_prevent_mutation
  on public.space_admin_audit_log;
create trigger space_admin_audit_log_prevent_mutation
before update or delete on public.space_admin_audit_log
for each row
execute function public.space_admin_audit_log_prevent_mutation();

create or replace function public.emit_access_change_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := (select auth.uid());
  v_action text;
  v_entity_type text;
  v_entity_id text;
  v_organization_id text;
  v_space_id text;
  v_previous jsonb := null;
  v_new jsonb := null;
begin
  if tg_table_name = 'space_memberships' then
    v_entity_type := 'space_membership';
    if tg_op = 'INSERT' then
      v_action := 'access.space_membership.created';
      v_entity_id := new.space_id || ':' || new.user_id::text;
      v_space_id := new.space_id;
      v_new := jsonb_build_object(
        'user_id', new.user_id,
        'space_id', new.space_id,
        'status', new.status
      );
    elsif tg_op = 'UPDATE' then
      if new.user_id is not distinct from old.user_id
        and new.space_id is not distinct from old.space_id
        and new.status is not distinct from old.status then
        return new;
      end if;

      v_action := 'access.space_membership.updated';
      v_entity_id := coalesce(new.space_id, old.space_id) || ':' || coalesce(new.user_id, old.user_id)::text;
      v_space_id := coalesce(new.space_id, old.space_id);
      v_previous := jsonb_build_object(
        'user_id', old.user_id,
        'space_id', old.space_id,
        'status', old.status
      );
      v_new := jsonb_build_object(
        'user_id', new.user_id,
        'space_id', new.space_id,
        'status', new.status
      );
    else
      v_action := 'access.space_membership.deleted';
      v_entity_id := old.space_id || ':' || old.user_id::text;
      v_space_id := old.space_id;
      v_previous := jsonb_build_object(
        'user_id', old.user_id,
        'space_id', old.space_id,
        'status', old.status
      );
    end if;

    select s.organization_id
      into v_organization_id
      from public.spaces s
      where s.id = v_space_id;
  elsif tg_table_name = 'organization_memberships' then
    v_entity_type := 'organization_membership';
    if tg_op = 'INSERT' then
      v_action := 'access.organization_membership.created';
      v_entity_id := new.organization_id || ':' || new.user_id::text;
      v_organization_id := new.organization_id;
      v_new := jsonb_build_object(
        'user_id', new.user_id,
        'organization_id', new.organization_id
      );
    elsif tg_op = 'UPDATE' then
      if new.user_id is not distinct from old.user_id
        and new.organization_id is not distinct from old.organization_id then
        return new;
      end if;

      v_action := 'access.organization_membership.updated';
      v_entity_id := coalesce(new.organization_id, old.organization_id) || ':' || coalesce(new.user_id, old.user_id)::text;
      v_organization_id := coalesce(new.organization_id, old.organization_id);
      v_previous := jsonb_build_object(
        'user_id', old.user_id,
        'organization_id', old.organization_id
      );
      v_new := jsonb_build_object(
        'user_id', new.user_id,
        'organization_id', new.organization_id
      );
    else
      v_action := 'access.organization_membership.deleted';
      v_entity_id := old.organization_id || ':' || old.user_id::text;
      v_organization_id := old.organization_id;
      v_previous := jsonb_build_object(
        'user_id', old.user_id,
        'organization_id', old.organization_id
      );
    end if;
  elsif tg_table_name = 'user_role' then
    v_entity_type := 'user_role';
    if tg_op = 'INSERT' then
      v_action := 'access.user_role.created';
      v_entity_id := new.id;
      v_organization_id := new.organization_id;
      v_space_id := new.space_id;
      v_new := jsonb_build_object(
        'user_id', new.user_id,
        'role_id', new.role_id,
        'organization_id', new.organization_id,
        'space_id', new.space_id
      );
    elsif tg_op = 'UPDATE' then
      if new.user_id is not distinct from old.user_id
        and new.role_id is not distinct from old.role_id
        and new.organization_id is not distinct from old.organization_id
        and new.space_id is not distinct from old.space_id then
        return new;
      end if;

      v_action := 'access.user_role.updated';
      v_entity_id := coalesce(new.id, old.id);
      v_organization_id := coalesce(new.organization_id, old.organization_id);
      v_space_id := coalesce(new.space_id, old.space_id);
      v_previous := jsonb_build_object(
        'user_id', old.user_id,
        'role_id', old.role_id,
        'organization_id', old.organization_id,
        'space_id', old.space_id
      );
      v_new := jsonb_build_object(
        'user_id', new.user_id,
        'role_id', new.role_id,
        'organization_id', new.organization_id,
        'space_id', new.space_id
      );
    else
      v_action := 'access.user_role.deleted';
      v_entity_id := old.id;
      v_organization_id := old.organization_id;
      v_space_id := old.space_id;
      v_previous := jsonb_build_object(
        'user_id', old.user_id,
        'role_id', old.role_id,
        'organization_id', old.organization_id,
        'space_id', old.space_id
      );
    end if;

    if v_organization_id is null and v_space_id is not null then
      select s.organization_id
        into v_organization_id
        from public.spaces s
        where s.id = v_space_id;
    end if;
  elsif tg_table_name = 'content_items' then
    if tg_op <> 'UPDATE' then
      return new;
    end if;

    if new.space_id is not distinct from old.space_id
      and new.owner_user_id is not distinct from old.owner_user_id
      and new.created_by is not distinct from old.created_by then
      return new;
    end if;

    v_action := 'access.content_item.link.updated';
    v_entity_type := 'content_item';
    v_entity_id := coalesce(new.id, old.id);
    v_space_id := coalesce(new.space_id, old.space_id);
    v_previous := jsonb_build_object(
      'space_id', old.space_id,
      'owner_user_id', old.owner_user_id,
      'created_by', old.created_by
    );
    v_new := jsonb_build_object(
      'space_id', new.space_id,
      'owner_user_id', new.owner_user_id,
      'created_by', new.created_by
    );

    select s.organization_id
      into v_organization_id
      from public.spaces s
      where s.id = v_space_id;
  else
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if v_organization_id is not null
    and not exists (
      select 1
      from public.organizations o
      where o.id = v_organization_id
    ) then
    v_organization_id := null;
  end if;

  if v_space_id is not null
    and not exists (
      select 1
      from public.spaces s
      where s.id = v_space_id
    ) then
    v_space_id := null;
  end if;

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
    v_action,
    v_entity_type,
    v_entity_id,
    v_organization_id,
    v_space_id,
    null,
    v_previous,
    v_new
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists space_memberships_access_audit
  on public.space_memberships;
create trigger space_memberships_access_audit
after insert or update or delete on public.space_memberships
for each row
execute function public.emit_access_change_audit();

drop trigger if exists organization_memberships_access_audit
  on public.organization_memberships;
create trigger organization_memberships_access_audit
after insert or update or delete on public.organization_memberships
for each row
execute function public.emit_access_change_audit();

drop trigger if exists user_role_access_audit
  on public.user_role;
create trigger user_role_access_audit
after insert or update or delete on public.user_role
for each row
execute function public.emit_access_change_audit();

drop trigger if exists content_items_access_audit
  on public.content_items;
create trigger content_items_access_audit
after update on public.content_items
for each row
execute function public.emit_access_change_audit();