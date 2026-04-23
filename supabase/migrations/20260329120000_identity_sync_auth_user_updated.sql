/*
 * AFTER UPDATE on auth.users -> same Edge internal ingest path as insert/delete (user.updated).
 */

create or replace function identity_sync.notify_auth_user_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg record;
  req_body jsonb;
  req_headers jsonb;
  entity_id text;
begin
  select c.edge_fanout_url, c.internal_secret
  into cfg
  from identity_sync.outbound_config as c
  where c.id = 1;

  if cfg is null or cfg.internal_secret is null or cfg.internal_secret = '' then
    raise warning
      'identity_sync: auth user update fan-out skipped (set identity_sync.outbound_config.internal_secret = same value as IDENTITY_INTERNAL_INGEST_SECRET in functions env)';
    return new;
  end if;

  select p.entity_id
  into entity_id
  from public.profiles as p
  where p.user_id = new.id;

  req_body := jsonb_build_object(
    'event', 'user.updated',
    'user', jsonb_build_object(
      'id', new.id::text,
      'entity_id', entity_id,
      'email', new.email,
      'app_metadata', coalesce(new.raw_app_meta_data, '{}'::jsonb),
      'user_metadata', coalesce(new.raw_user_meta_data, '{}'::jsonb)
    )
  );

  req_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'X-Identity-Internal-Secret', cfg.internal_secret
  );

  perform net.http_post(
    cfg.edge_fanout_url,
    req_body,
    '{}'::jsonb,
    req_headers,
    8000
  );

  return new;
end;
$$;

comment on function identity_sync.notify_auth_user_updated() is
  'AFTER UPDATE on auth.users: async HTTP POST to identity_lifecycle_fanout (user.updated). Skips with WARNING if internal_secret unset.';

alter function identity_sync.notify_auth_user_updated() owner to postgres;

drop trigger if exists on_auth_user_updated_identity_fanout on auth.users;

create trigger on_auth_user_updated_identity_fanout
after update on auth.users
for each row
execute function identity_sync.notify_auth_user_updated();
