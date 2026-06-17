/*
 * node↔body bridge — durable outbox enqueue under the user's RLS authority
 * (slice-03 §2.3 step 2, §8.1 decisions 1 & 6).
 *
 * why this function exists
 * - the fan-out endpoint runs STRICTLY under the user's RLS-scoped supabase-js
 *   client (never service-role). But public.outbox_jobs is internal-only: its
 *   RLS grants insert/select to service_role ONLY (see 20260411170000), so an
 *   `authenticated` caller cannot write the durable safety-net row directly.
 * - this SECURITY DEFINER RPC is the narrow, audited seam that lets the user's
 *   own session enqueue a `body.linked` job, GATED by an explicit node-authority
 *   check: the caller must be the node's creator AND hold space.knowledge.create
 *   in the node's space (the same gate RLS just enforced on the node INSERT).
 *   It therefore cannot widen access — it only records intent for a node the
 *   caller authoritatively owns.
 *
 * rls authority is preserved
 * - the node was inserted under the caller's RLS context (fan-out step 1); this
 *   function re-checks that authority from auth.uid() before writing the row, so
 *   "node exists under RLS ⇒ job exists" without ever exposing the outbox table.
 * - the payload is the zod BodyBridgeEnvelope (@workspace/knowledge-contracts).
 *   The synchronous POC fan-out closes the job itself; a future durable JetStream
 *   consumer claims the SAME row via the existing rpc_outbox_claim_jobs — a
 *   seamless swap, no shape change.
 *
 * note: NO core graph DDL (no new column/table/ALTER on nodes/edges). This is the
 * single pinpoint app-layer function the slice needs; channel='operation'.
 */

create or replace function public.rpc_enqueue_body_bridge_job(
  p_node_id text,
  p_payload jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_space_id text;
  v_created_by uuid;
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
    'body.linked',
    1,
    'operation',
    'body-bridge',
    coalesce(p_payload, '{}'::jsonb),
    trim(p_idempotency_key)
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
  'Enqueues a durable body.linked outbox job for a kind=text node the caller authoritatively owns (created_by = auth.uid() AND space.knowledge.create). The single seam letting the RLS-scoped fan-out write the internal-only outbox without service-role.';

alter function public.rpc_enqueue_body_bridge_job(text, jsonb, text) owner to postgres;

revoke all on function public.rpc_enqueue_body_bridge_job(text, jsonb, text) from public;
grant execute on function public.rpc_enqueue_body_bridge_job(text, jsonb, text) to authenticated;

/*
 * reconcile read helper — surface a node's bridge state under the caller's RLS.
 *
 * The reconciler (apps/author … text-resource.fanout.ts §2.4) reads a node's
 * current body_ref + space under the user's RLS client via a plain PostgREST
 * select on knowledge_resources, so it needs NO new function for the read path.
 * The compensating writes it performs (set body_ref, delete orphan body) also go
 * through RLS (set body_ref) and the Payload Local API (delete orphan). The ONLY
 * service-role use is in the reconciler's systemic orphan-repair path, which is
 * an application concern, not SQL — hence no extra DDL here.
 */
