/*
 * space signals: the first change after a throttle window signals at once,
 * whatever the second it falls in.
 *
 * what was wrong
 *   private.sync_mark returned early when a kind's mark was already this
 *   second's — before it looked at the signal. with a long window (25 s,
 *   say) a change at 24.5 s is inside the window and stays silent, and one
 *   at 25.2 s is the first of the next window, but its mark was only 0.7 s
 *   old: it returned early and sent nothing. a browser that pulled at the
 *   end of the window missed it, and if nothing else changed it waited for
 *   its heartbeat.
 *
 * what it does now
 *   the mark and the signal are decided apart. the one-second gate still
 *   decides whether the mark moves; whether a signal goes out is decided by
 *   the kind's window alone. each kind keeps until when it stays silent
 *   (graph_silent_until, graph_delete_silent_until, documents_silent_until):
 *   set when it signals, to that instant plus the window the signal stated
 *   — the same window the listening browsers time their follow-up pull by.
 *   a change once that instant has passed signals, even inside the second
 *   of the previous mark.
 *
 *   the common case under a bulk write stays one row read and nothing else:
 *   a change whose mark is already this second's and whose kind is still
 *   silent returns before any write, lock or count of who is present. the
 *   window is computed only when a signal is about to go out.
 *
 *   a deletion still signals `graph-delete` only, and silences `graph` with
 *   it: the sweep it asks for pulls every table first.
 *
 * the silence a signal states is the silence the server keeps
 *   a signal tells the listening browsers how long the space stays silent
 *   for its kind, and they pull once more when that silence ends. the
 *   server keeps exactly that silence: a change inside it is not signaled,
 *   the first change after it is, with the window as it is then. a change
 *   in presence therefore takes effect from the next signal, never inside a
 *   silence already stated: when the space empties, the 25 seconds stated
 *   still hold; when it fills, the next change after the 1 second stated
 *   signals at once, stating the longer window, and the browsers time their
 *   last pull by it.
 *
 * one ceiling for the window, shared with the browsers
 *   private.sync_config's window bounds are owner-editable, so they are
 *   held: the ceiling (window_max_ms) is at most ten minutes, the floor
 *   (window_min_ms) at least a millisecond and never above the ceiling. the
 *   browsers hold any window they are told to the same ten minutes, so the
 *   last pull they time always covers the silence the server keeps. the
 *   floor-under-ceiling check spans two rows, so it is a constraint trigger;
 *   it can be deferred to change both bounds in two statements.
 *
 * existing rows need nothing: a kind with no silence recorded signals at
 * its next change.
 */

alter table private.space_sync_state
  add column if not exists graph_silent_until timestamptz,
  add column if not exists graph_delete_silent_until timestamptz,
  add column if not exists documents_silent_until timestamptz;

create or replace function private.sync_mark(p_space_id text, p_kind text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now constant timestamptz := clock_timestamp();
  v_fresh constant timestamptz := v_now - interval '1 second';
  v_state private.space_sync_state;
  v_window integer;
  v_until timestamptz;
  v_silent boolean;
begin
  if p_kind not in ('graph', 'graph-delete', 'documents') then
    raise exception 'sync_mark: unknown kind %', p_kind;
  end if;
  -- the common case under a bulk write: the mark is already this second's
  -- and the kind is still silent; nothing to write, lock or send.
  -- (an assignment, not an `if`: the condition of an `if` ends at the first
  -- `then`, the case's own.)
  select * into v_state from private.space_sync_state s where s.space_id = p_space_id;
  v_silent := found and case p_kind
      when 'graph' then
        v_state.graph_changed_at >= v_fresh
        and v_state.graph_silent_until > v_now
      when 'graph-delete' then
        v_state.graph_changed_at >= v_fresh
        and v_state.graph_deleted_at >= v_fresh
        and v_state.graph_delete_silent_until > v_now
      else
        v_state.documents_changed_at >= v_fresh
        and v_state.documents_silent_until > v_now
    end;
  if v_silent then
    return;
  end if;
  -- a space deleted in this very transaction gets no row: the deferred
  -- trigger would otherwise insert one at commit, after the space is gone,
  -- and fail the whole teardown.
  insert into private.space_sync_state (space_id)
  select p_space_id
  where exists (select 1 from public.spaces s where s.id = p_space_id)
  on conflict (space_id) do nothing;
  -- another writer holds the row: it is marking and signaling this instant.
  select * into v_state
  from private.space_sync_state s
  where s.space_id = p_space_id
  for update skip locked;
  if not found then
    return;
  end if;

  -- the marks: at most one write per second per kind.
  if p_kind in ('graph', 'graph-delete') then
    update private.space_sync_state
       set graph_changed_at = v_now
     where space_id = p_space_id
       and (graph_changed_at is null or graph_changed_at < v_fresh);
  end if;
  if p_kind = 'graph-delete' then
    update private.space_sync_state
       set graph_deleted_at = v_now
     where space_id = p_space_id
       and (graph_deleted_at is null or graph_deleted_at < v_fresh);
  end if;
  if p_kind = 'documents' then
    update private.space_sync_state
       set documents_changed_at = v_now
     where space_id = p_space_id
       and (documents_changed_at is null or documents_changed_at < v_fresh);
  end if;

  -- the signal, leading edge: the first change of a window is signaled at
  -- once, the rest of the window is silent; the browsers' follow-up pull,
  -- one window later, covers it.
  v_silent := case p_kind
      when 'graph' then v_state.graph_silent_until > v_now
      when 'graph-delete' then v_state.graph_delete_silent_until > v_now
      else v_state.documents_silent_until > v_now
    end;
  if v_silent then
    return;
  end if;
  v_window := private.sync_window_ms(p_space_id);
  v_until := v_now + make_interval(secs => v_window / 1000.0);
  if p_kind = 'graph' then
    update private.space_sync_state
       set graph_signaled_at = v_now, graph_silent_until = v_until
     where space_id = p_space_id;
  elsif p_kind = 'graph-delete' then
    update private.space_sync_state
       set graph_delete_signaled_at = v_now, graph_delete_silent_until = v_until,
           graph_signaled_at = v_now, graph_silent_until = v_until
     where space_id = p_space_id;
  else
    update private.space_sync_state
       set documents_signaled_at = v_now, documents_silent_until = v_until
     where space_id = p_space_id;
  end if;
  begin
    perform private.sync_emit(
      'space:' || p_space_id || ':' || v_state.epoch,
      'changed',
      jsonb_build_object('kind', p_kind, 'window_ms', v_window));
  exception when others then
    -- the write goes through; the probe and the full pass still converge.
    raise warning 'space signal not sent for %: %', p_space_id, sqlerrm;
  end;
end;
$$;

revoke all on function private.sync_mark(text, text) from public, anon, authenticated;

-- the window bounds: at most ten minutes, and a floor that states a window
alter table private.sync_config drop constraint if exists sync_config_window_bounds;
alter table private.sync_config add constraint sync_config_window_bounds
  check (key not in ('window_min_ms', 'window_max_ms') or (value >= 1 and value <= 600000));

create or replace function private.sync_config_windows_ordered()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select c.value from private.sync_config c where c.key = 'window_min_ms')
     > (select c.value from private.sync_config c where c.key = 'window_max_ms') then
    raise exception 'sync_config: window_min_ms must not exceed window_max_ms';
  end if;
  return null;
end;
$$;

revoke all on function private.sync_config_windows_ordered() from public, anon, authenticated;

drop trigger if exists sync_config_windows_ordered on private.sync_config;
create constraint trigger sync_config_windows_ordered
  after insert or update on private.sync_config
  deferrable initially immediate
  for each row execute function private.sync_config_windows_ordered();
