/*
 * node↔body bridge — namespace the outbox idempotency key by event type
 * (2026-06-17 review finding #6). Forward-only corrective migration; the
 * enqueue function (20260616190000) is already applied, so this re-creates it.
 *
 * the latent bug
 * - `outbox_jobs.idempotency_key` is GLOBALLY unique, and the enqueue does
 *   `on conflict (idempotency_key) do update … returning *`, i.e. it returns the
 *   EXISTING row as success on conflict. Today only one event type
 *   (`body.linked`) is enqueued with key `body-bridge:<node_id>`, so this is
 *   harmless. But the moment a SECOND event type (e.g. `body.unlinked`) is
 *   enqueued for the same node, it would collide on the same key and silently
 *   no-op onto the stale `body.linked` row — a lost update.
 *
 * the fix
 * - namespace the stored key by the event type the function controls. The
 *   function already hardcodes event_name='body.linked', so the persisted key
 *   becomes `body.linked:<caller key>`. Distinct event types thus get distinct
 *   keys and can never collide, regardless of the base key the caller passes.
 * - this is internal to the function; callers keep passing a node-scoped base
 *   key. The future async JetStream consumer claims the row by id/claim-token,
 *   not by reconstructing the key, so it is unaffected.
 *
 * unchanged: the SECURITY DEFINER seam, the node-authority gate
 * (created_by = auth.uid() AND space.knowledge.create), search_path pinning,
 * owner, and grants — only the persisted idempotency key is namespaced.
 */

create or replace function public.rpc_enqueue_body_bridge_job(
  p_node_id text,
  p_payload jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_space_id text;
  v_created_by uuid;
  v_event_name text := 'body.linked';
  v_idempotency_key text;
  v_row public.outbox_jobs%rowtype;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'rpc_enqueue_body_bridge_job: not authenticated';
  end if;

  if trim(coalesce(p_node_id, '')) = '' then
    raise exception 'rpc_enqueue_body_bridge_job: node_id is required';
  end if;

  if trim(coalesce(p_idempotency_key, '')) = '' then
    raise exception 'rpc_enqueue_body_bridge_job: idempotency_key is required';
  end if;

  -- explicit node-authority check: the caller must own the node and hold
  -- space.knowledge.create in its space (the gate RLS enforced on step 1).
  select r.space_id, r.created_by
    into v_space_id, v_created_by
  from public.knowledge_resources r
  where r.id = trim(p_node_id);

  if v_space_id is null then
    raise exception 'rpc_enqueue_body_bridge_job: node not found';
  end if;

  if v_created_by <> v_uid then
    raise exception 'rpc_enqueue_body_bridge_job: caller is not the node creator';
  end if;

  if not public.auth_user_can_access_in_space(v_space_id, 'space.knowledge.create') then
    raise exception 'rpc_enqueue_body_bridge_job: not allowed in this space';
  end if;

  -- namespace the persisted key by the event type so a future second event type
  -- for the same node cannot collide onto this row (review finding #6).
  v_idempotency_key := v_event_name || ':' || trim(p_idempotency_key);

  insert into public.outbox_jobs (
    aggregate_type,
    aggregate_id,
    event_name,
    event_version,
    channel,
    operation_key,
    payload,
    idempotency_key
  )
  values (
    'knowledge_body',
    trim(p_node_id),
    v_event_name,
    1,
    'operation',
    'body-bridge',
    coalesce(p_payload, '{}'::jsonb),
    v_idempotency_key
  )
  on conflict (idempotency_key)
  do update set idempotency_key = excluded.idempotency_key
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'aggregate_id', v_row.aggregate_id,
    'idempotency_key', v_row.idempotency_key
  );
end;
$$;

comment on function public.rpc_enqueue_body_bridge_job(text, jsonb, text) is
  'Enqueues a durable body.linked outbox job for a kind=text node the caller authoritatively owns (created_by = auth.uid() AND space.knowledge.create). The persisted idempotency key is namespaced by event type so distinct event types never collide (review finding #6).';

alter function public.rpc_enqueue_body_bridge_job(text, jsonb, text) owner to postgres;

revoke all on function public.rpc_enqueue_body_bridge_job(text, jsonb, text) from public;
grant execute on function public.rpc_enqueue_body_bridge_job(text, jsonb, text) to authenticated;
