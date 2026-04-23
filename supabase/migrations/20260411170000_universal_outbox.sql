/*
 * Universal outbox for idempotent side effects.
 *
 * public.outbox_jobs remains the canonical business ledger for dedupe, audit, and
 * operator-facing status. Low-level delivery transport is delegated to pgmq so the
 * queue visibility / delete / retry mechanics come from a maintained Postgres queue
 * implementation instead of custom claim SQL.
 */

create extension if not exists pgmq;

create table public.outbox_jobs (
  id text primary key default public.entity_id_generate('out'),
  aggregate_type text not null,
  aggregate_id text not null,
  event_name text not null,
  event_version integer not null default 1,
  channel text not null check (channel in ('email', 'sms', 'push', 'operation')),
  template_key text,
  operation_key text,
  recipient text,
  locale text,
  payload jsonb not null,
  idempotency_key text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  attempt_count integer not null default 0,
  queue_message_id bigint,
  available_at timestamptz not null default timezone('utc', now()),
  claimed_at timestamptz,
  claimed_by text,
  claim_token uuid,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.outbox_jobs is
  'Universal transactional outbox / dedupe ledger for notifications and future side effects. Internal-only table; client access stays denied by default via RLS with no anon/authenticated policies.';

comment on column public.outbox_jobs.idempotency_key is
  'Stable business-intent dedupe key. Do not use message UUIDs as the primary semantic key.';

comment on column public.outbox_jobs.queue_message_id is
  'Transport-layer pgmq message id. Business truth stays in outbox_jobs; queue mechanics stay in pgmq.';

create unique index outbox_jobs_idempotency_key_uniq
  on public.outbox_jobs (idempotency_key);

create index outbox_jobs_status_available_idx
  on public.outbox_jobs (status, available_at, created_at)
  where status = 'pending';

create index outbox_jobs_aggregate_idx
  on public.outbox_jobs (aggregate_type, aggregate_id, created_at desc);

create index outbox_jobs_channel_status_idx
  on public.outbox_jobs (channel, status, available_at);

create or replace function public.set_outbox_jobs_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create trigger outbox_jobs_set_updated_at
before update on public.outbox_jobs
for each row
execute function public.set_outbox_jobs_updated_at();

create or replace function public.outbox_queue_name(p_channel text)
returns text
language sql
immutable
set search_path = public
as $$
  select case trim(coalesce(p_channel, ''))
    when 'email' then 'outbox_email'
    when 'sms' then 'outbox_sms'
    when 'push' then 'outbox_push'
    when 'operation' then 'outbox_operation'
    else null
  end;
$$;

create or replace function public.ensure_outbox_queue(p_queue_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if trim(coalesce(p_queue_name, '')) = '' then
    raise exception 'queue_name is required';
  end if;

  if to_regclass(format('pgmq.q_%s', p_queue_name)) is null then
    perform pgmq.create(p_queue_name);
  end if;
end;
$$;

alter function public.ensure_outbox_queue(text) owner to postgres;

revoke all on function public.ensure_outbox_queue(text) from public;
grant execute on function public.ensure_outbox_queue(text) to service_role;

select public.ensure_outbox_queue('outbox_email');
select public.ensure_outbox_queue('outbox_sms');
select public.ensure_outbox_queue('outbox_push');
select public.ensure_outbox_queue('outbox_operation');

create or replace function public.outbox_jobs_enqueue_transport()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delay_seconds integer;
  v_message_id bigint;
  v_queue_name text;
begin
  if new.status <> 'pending' then
    return new;
  end if;

  v_queue_name := public.outbox_queue_name(new.channel);
  if v_queue_name is null then
    raise exception 'unsupported outbox channel';
  end if;

  perform public.ensure_outbox_queue(v_queue_name);

  v_delay_seconds := greatest(
    coalesce(
      ceil(extract(epoch from (new.available_at - timezone('utc', now()))))::integer,
      0
    ),
    0
  );

  select *
    into v_message_id
  from pgmq.send(
    v_queue_name,
    jsonb_build_object(
      'job_id', new.id,
      'channel', new.channel
    ),
    v_delay_seconds
  );

  update public.outbox_jobs
  set queue_message_id = v_message_id
  where id = new.id;

  return new;
end;
$$;

create trigger outbox_jobs_enqueue_transport
after insert on public.outbox_jobs
for each row
execute function public.outbox_jobs_enqueue_transport();

create or replace function public.outbox_jobs_delete_transport()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue_name text;
begin
  if old.queue_message_id is null then
    return old;
  end if;

  v_queue_name := public.outbox_queue_name(old.channel);
  if v_queue_name is not null then
    perform pgmq.delete(v_queue_name, old.queue_message_id);
  end if;

  return old;
end;
$$;

create trigger outbox_jobs_delete_transport
after delete on public.outbox_jobs
for each row
execute function public.outbox_jobs_delete_transport();

alter table public.outbox_jobs enable row level security;

revoke all on public.outbox_jobs from public;
grant select, insert, update, delete on public.outbox_jobs to service_role;

create policy "outbox_jobs select for service_role"
on public.outbox_jobs
for select
to service_role
using ( true );

create policy "outbox_jobs insert for service_role"
on public.outbox_jobs
for insert
to service_role
with check ( true );

create policy "outbox_jobs update for service_role"
on public.outbox_jobs
for update
to service_role
using ( true )
with check ( true );

create policy "outbox_jobs delete for service_role"
on public.outbox_jobs
for delete
to service_role
using ( true );

-- No authenticated/anon policies by design: outbox_jobs is internal-only and is
-- accessed through security-definer RPCs plus service-role operational tooling.

create or replace function public.rpc_enqueue_outbox_job(
  p_aggregate_type text,
  p_aggregate_id text,
  p_event_name text,
  p_channel text,
  p_template_key text default null,
  p_operation_key text default null,
  p_recipient text default null,
  p_locale text default null,
  p_payload jsonb default '{}'::jsonb,
  p_idempotency_key text default null,
  p_event_version integer default 1,
  p_available_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.outbox_jobs%rowtype;
begin
  if trim(coalesce(p_aggregate_type, '')) = '' then
    raise exception 'aggregate_type is required';
  end if;

  if trim(coalesce(p_aggregate_id, '')) = '' then
    raise exception 'aggregate_id is required';
  end if;

  if trim(coalesce(p_event_name, '')) = '' then
    raise exception 'event_name is required';
  end if;

  if trim(coalesce(p_channel, '')) not in ('email', 'sms', 'push', 'operation') then
    raise exception 'unsupported outbox channel';
  end if;

  if trim(coalesce(p_idempotency_key, '')) = '' then
    raise exception 'idempotency_key is required';
  end if;

  insert into public.outbox_jobs (
    aggregate_type,
    aggregate_id,
    event_name,
    event_version,
    channel,
    template_key,
    operation_key,
    recipient,
    locale,
    payload,
    idempotency_key,
    available_at
  )
  values (
    trim(p_aggregate_type),
    trim(p_aggregate_id),
    trim(p_event_name),
    greatest(coalesce(p_event_version, 1), 1),
    trim(p_channel),
    nullif(trim(coalesce(p_template_key, '')), ''),
    nullif(trim(coalesce(p_operation_key, '')), ''),
    nullif(trim(coalesce(p_recipient, '')), ''),
    nullif(trim(coalesce(p_locale, '')), ''),
    coalesce(p_payload, '{}'::jsonb),
    trim(p_idempotency_key),
    coalesce(p_available_at, timezone('utc', now()))
  )
  on conflict (idempotency_key)
  do update set idempotency_key = excluded.idempotency_key
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'channel', v_row.channel,
    'completed_at', v_row.completed_at,
    'idempotency_key', v_row.idempotency_key
  );
end;
$$;

alter function public.rpc_enqueue_outbox_job(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  integer,
  timestamptz
) owner to postgres;

revoke all on function public.rpc_enqueue_outbox_job(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  integer,
  timestamptz
) from public;

grant execute on function public.rpc_enqueue_outbox_job(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  integer,
  timestamptz
) to service_role;

create or replace function public.rpc_outbox_claim_jobs(
  p_consumer text,
  p_limit integer default 10,
  p_channels text[] default null
)
returns setof public.outbox_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channels text[];
  v_claimed integer;
  v_claimed_row public.outbox_jobs%rowtype;
  v_consumer text;
  v_job_id text;
  v_queue_name text;
  v_transport record;
  v_visibility_timeout_seconds integer := 300;
begin
  v_consumer := nullif(trim(coalesce(p_consumer, '')), '');
  v_claimed := 0;
  v_channels := case
    when p_channels is null or array_length(p_channels, 1) is null
      then array['email', 'sms', 'push', 'operation']::text[]
    else p_channels
  end;

  for v_queue_name in
    select public.outbox_queue_name(channel)
    from unnest(v_channels) as channel
    where public.outbox_queue_name(channel) is not null
  loop
    exit when v_claimed >= greatest(coalesce(p_limit, 1), 1);

    for v_transport in
      select *
      from pgmq.read(
        v_queue_name,
        v_visibility_timeout_seconds,
        greatest(greatest(coalesce(p_limit, 1), 1) - v_claimed, 1)
      )
    loop
      v_job_id := trim(coalesce(v_transport.message ->> 'job_id', ''));

      if v_job_id = '' then
        perform pgmq.delete(v_queue_name, v_transport.msg_id);
        continue;
      end if;

      update public.outbox_jobs j
      set status = 'processing',
          attempt_count = greatest(j.attempt_count, greatest(coalesce(v_transport.read_ct, 1)::integer, 1)),
          claimed_at = timezone('utc', now()),
          claimed_by = v_consumer,
          claim_token = extensions.gen_random_uuid(),
          last_error = null,
          queue_message_id = coalesce(j.queue_message_id, v_transport.msg_id),
          updated_at = timezone('utc', now())
      where j.id = v_job_id
        and j.status in ('pending', 'processing')
      returning j.* into v_claimed_row;

      if not found then
        perform pgmq.delete(v_queue_name, v_transport.msg_id);
        continue;
      end if;

      return next v_claimed_row;
      v_claimed := v_claimed + 1;

      exit when v_claimed >= greatest(coalesce(p_limit, 1), 1);
    end loop;
  end loop;

  return;
end;
$$;

alter function public.rpc_outbox_claim_jobs(text, integer, text[]) owner to postgres;

revoke all on function public.rpc_outbox_claim_jobs(text, integer, text[]) from public;
grant execute on function public.rpc_outbox_claim_jobs(text, integer, text[]) to service_role;

create or replace function public.rpc_outbox_complete_job(
  p_job_id text,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue_message_id bigint;
  v_queue_name text;
begin
  select j.queue_message_id, public.outbox_queue_name(j.channel)
    into v_queue_message_id, v_queue_name
  from public.outbox_jobs j
  where j.id = p_job_id
    and j.claim_token = p_claim_token
    and j.status = 'processing'
  for update;

  if not found then
    return false;
  end if;

  if v_queue_message_id is not null and v_queue_name is not null then
    perform pgmq.delete(v_queue_name, v_queue_message_id);
  end if;

  update public.outbox_jobs j
  set status = 'completed',
      completed_at = timezone('utc', now()),
      claimed_at = null,
      claimed_by = null,
      claim_token = null,
      updated_at = timezone('utc', now())
  where j.id = p_job_id
    and j.claim_token = p_claim_token
    and j.status = 'processing';

  return found;
end;
$$;

alter function public.rpc_outbox_complete_job(text, uuid) owner to postgres;

revoke all on function public.rpc_outbox_complete_job(text, uuid) from public;
grant execute on function public.rpc_outbox_complete_job(text, uuid) to service_role;

create or replace function public.rpc_outbox_retry_job(
  p_job_id text,
  p_claim_token uuid,
  p_error text default null,
  p_retry_seconds integer default 60,
  p_terminal boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue_message_id bigint;
  v_queue_name text;
  v_retry_seconds integer;
begin
  v_retry_seconds := greatest(coalesce(p_retry_seconds, 60), 1);

  select j.queue_message_id, public.outbox_queue_name(j.channel)
    into v_queue_message_id, v_queue_name
  from public.outbox_jobs j
  where j.id = p_job_id
    and j.claim_token = p_claim_token
    and j.status = 'processing'
  for update;

  if not found then
    return false;
  end if;

  if v_queue_message_id is not null and v_queue_name is not null then
    if coalesce(p_terminal, false) then
      perform pgmq.archive(v_queue_name, v_queue_message_id);
    else
      perform pgmq.set_vt(v_queue_name, v_queue_message_id, v_retry_seconds);
    end if;
  end if;

  update public.outbox_jobs j
  set status = case when coalesce(p_terminal, false) then 'failed' else 'pending' end,
      available_at = case
        when coalesce(p_terminal, false)
          then j.available_at
        else timezone('utc', now()) + make_interval(secs => v_retry_seconds)
      end,
      last_error = left(coalesce(p_error, 'delivery failed'), 2000),
      claimed_at = null,
      claimed_by = null,
      claim_token = null,
      updated_at = timezone('utc', now())
  where j.id = p_job_id
    and j.claim_token = p_claim_token
    and j.status = 'processing';

  return found;
end;
$$;

alter function public.rpc_outbox_retry_job(text, uuid, text, integer, boolean) owner to postgres;

revoke all on function public.rpc_outbox_retry_job(text, uuid, text, integer, boolean) from public;
grant execute on function public.rpc_outbox_retry_job(text, uuid, text, integer, boolean) to service_role;

create or replace function public.rpc_outbox_metrics(
  p_failed_since_hours integer default 24,
  p_processing_stale_after_seconds integer default 300
)
returns jsonb
language sql
security definer
set search_path = public
as $$
with params as (
  select
    timezone('utc', now()) as observed_at,
    greatest(coalesce(p_failed_since_hours, 24), 1) as failed_since_hours,
    greatest(coalesce(p_processing_stale_after_seconds, 300), 1) as processing_stale_after_seconds
),
jobs as (
  select
    j.*,
    p.observed_at,
    p.failed_since_hours,
    p.processing_stale_after_seconds,
    greatest(extract(epoch from (p.observed_at - j.created_at)), 0)::bigint as created_age_seconds,
    case
      when j.status = 'pending'
        then greatest(extract(epoch from (p.observed_at - j.available_at)), 0)::bigint
      else null
    end as pending_lag_seconds,
    case
      when j.status = 'processing' and j.claimed_at is not null
        then greatest(extract(epoch from (p.observed_at - j.claimed_at)), 0)::bigint
      else null
    end as processing_age_seconds
  from public.outbox_jobs j
  cross join params p
),
summary as (
  select
    count(*) filter (where status = 'pending')::bigint as pending_total,
    count(*) filter (where status = 'processing')::bigint as processing_total,
    count(*) filter (where status = 'completed')::bigint as completed_total,
    count(*) filter (where status = 'failed')::bigint as terminal_failures_total,
    count(*) filter (where attempt_count > 1)::bigint as retried_jobs_total,
    count(*) filter (where status in ('pending', 'processing') and attempt_count > 1)::bigint as retry_backlog_total,
    coalesce(max(created_age_seconds) filter (where status = 'pending'), 0)::bigint as oldest_pending_job_age_seconds,
    coalesce(max(pending_lag_seconds) filter (where status = 'pending'), 0)::bigint as oldest_pending_lag_seconds,
    coalesce(max(processing_age_seconds) filter (where status = 'processing'), 0)::bigint as oldest_processing_age_seconds,
    count(*) filter (
      where status = 'processing'
        and coalesce(processing_age_seconds, 0) >= processing_stale_after_seconds
    )::bigint as stale_processing_total,
    count(*) filter (
      where status = 'failed'
        and updated_at >= observed_at - make_interval(hours => failed_since_hours)
    )::bigint as terminal_failures_in_window
  from jobs
),
per_channel as (
  select
    channel,
    count(*) filter (where status = 'pending')::bigint as pending,
    count(*) filter (where status = 'processing')::bigint as processing,
    count(*) filter (where status = 'completed')::bigint as completed,
    count(*) filter (where status = 'failed')::bigint as failed,
    count(*) filter (where attempt_count > 1)::bigint as retried_total,
    coalesce(max(created_age_seconds) filter (where status = 'pending'), 0)::bigint as oldest_pending_job_age_seconds,
    coalesce(max(pending_lag_seconds) filter (where status = 'pending'), 0)::bigint as oldest_pending_lag_seconds,
    coalesce(max(processing_age_seconds) filter (where status = 'processing'), 0)::bigint as oldest_processing_age_seconds,
    count(*) filter (
      where status = 'processing'
        and coalesce(processing_age_seconds, 0) >= processing_stale_after_seconds
    )::bigint as stale_processing
  from jobs
  group by channel
)
select jsonb_build_object(
  'observed_at', params.observed_at,
  'summary', jsonb_build_object(
    'pending_total', summary.pending_total,
    'processing_total', summary.processing_total,
    'completed_total', summary.completed_total,
    'terminal_failures_total', summary.terminal_failures_total,
    'terminal_failures_in_window', summary.terminal_failures_in_window,
    'retried_jobs_total', summary.retried_jobs_total,
    'retry_backlog_total', summary.retry_backlog_total,
    'oldest_pending_job_age_seconds', summary.oldest_pending_job_age_seconds,
    'oldest_pending_lag_seconds', summary.oldest_pending_lag_seconds,
    'oldest_processing_age_seconds', summary.oldest_processing_age_seconds,
    'stale_processing_total', summary.stale_processing_total,
    'failed_since_hours', params.failed_since_hours,
    'processing_stale_after_seconds', params.processing_stale_after_seconds
  ),
  'backlog_by_channel', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'channel', channel,
        'pending', pending,
        'processing', processing,
        'completed', completed,
        'failed', failed,
        'retried_total', retried_total,
        'oldest_pending_job_age_seconds', oldest_pending_job_age_seconds,
        'oldest_pending_lag_seconds', oldest_pending_lag_seconds,
        'oldest_processing_age_seconds', oldest_processing_age_seconds,
        'stale_processing', stale_processing
      )
      order by channel
    )
    from per_channel
  ), '[]'::jsonb)
)
from params
cross join summary;
$$;

alter function public.rpc_outbox_metrics(integer, integer) owner to postgres;

revoke all on function public.rpc_outbox_metrics(integer, integer) from public;
grant execute on function public.rpc_outbox_metrics(integer, integer) to service_role;

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
  v_org_name text;
  v_space_name text;
  v_space_slug text;
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
  select s.organization_id, s.name, s.slug, o.name
    into v_org_id, v_space_name, v_space_slug, v_org_name
  from public.spaces s
  join public.organizations o on o.id = s.organization_id
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

  insert into public.outbox_jobs (
    aggregate_type,
    aggregate_id,
    event_name,
    event_version,
    channel,
    template_key,
    recipient,
    locale,
    payload,
    idempotency_key
  )
  values (
    'space_invite',
    v_id,
    'space_invite.email_requested',
    1,
    'email',
    'space_invite',
    v_email,
    'en',
    jsonb_build_object(
      'channel', 'email',
      'to', v_email,
      'locale', 'en',
      'template', jsonb_build_object(
        'templateKey', 'space_invite',
        'data', jsonb_build_object(
          'inviteUrl', '',
          'spaceName', v_space_name,
          'organizationName', v_org_name,
          'expiresAtUtc', v_expires
        )
      ),
      'context', jsonb_build_object(
        'spaceInviteId', v_id,
        'spaceSlug', v_space_slug,
        'inviteToken', v_token
      )
    ),
    'notify:space-invite-email:' || v_id
  );

  return jsonb_build_object(
    'id', v_id,
    'token', v_token,
    'expires_at', v_expires
  );
end;
$$;

comment on function public.rpc_create_space_invite(text, text, text) is
  'Creates a pending space invite and enqueues a universal outbox email job in the same transaction.';

alter function public.rpc_create_space_invite(text, text, text) owner to postgres;

revoke all on function public.rpc_create_space_invite(text, text, text) from public;
grant execute on function public.rpc_create_space_invite(text, text, text) to authenticated;