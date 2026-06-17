-- p0 remediation (adr-0009): resolve-query transport — close the authenticated arbitrary-sql surface.
--
-- background
--   `public.resolve_projection_query(p_sql text, p_params jsonb)` was `security invoker`
--   with `grant execute ... to authenticated`. its only guard was a
--   `lower(ltrim(p_sql)) like 'with recursive%'` prefix check before `execute p_sql`.
--   that guard does not stop data-modifying ctes, so any authenticated user could call
--   the rpc directly through postgrest and run arbitrary read/write sql bounded only by
--   table rls — bypassing the ts compiler, its field/operator allow-list and the
--   projection contract. confirmed p0 (finding #1, 2026-06-17 review).
--
-- decision (adr-0009, option c / variant b — inline execute on a server connection)
--   the ts-compiled, fully-parameterized recursive-cte select is now executed
--   server-side from the next runtime over a DIRECT pg connection that adopts the
--   requesting user's jwt inside one explicit transaction:
--       begin;
--       set local role authenticated;
--       set local request.jwt.claims = <user claims json>;
--       <compiled sql>  -- with bound params
--       commit;
--   the connection logs in as a dedicated NON-OWNER, NON-bypassrls backend role
--   (`projection_resolver`) and downgrades to `authenticated` for the statement, so the
--   select runs AS THE USER and rls is the sole access authority (adr-0001/0003 §2).
--   raw sql text never crosses the client→server boundary — the client sends only a
--   projectionId; the compiler produces the sql on the server (adr-0003 §1.1).
--
-- this migration is FORWARD-ONLY (no reverse ddl). it:
--   1. revokes/removes the postgrest-callable function (no authenticated arbitrary sql);
--   2. provisions the dedicated backend role the new transport connects with.

-- ── 1. remove the exploitable transport function ──────────────────────────────
-- variant b (adr-0009 §a, recommended): the resolver inlines the `execute ... using`
-- on its own server connection, so the standalone function is no longer needed. its
-- defence-in-depth `with recursive%` check now lives in the ts resolver. dropping the
-- function also removes every grant on it (including the exploited `authenticated`
-- grant), so the postgrest arbitrary-sql path is physically gone.
drop function if exists public.resolve_projection_query(text, jsonb);

-- ── 2. dedicated resolve-transport backend role ───────────────────────────────
-- `projection_resolver` is the login role the next server connects with via
-- PROJECTION_RESOLVER_DATABASE_URL. trust boundary (adr-0009):
--   • LOGIN  — the server opens a real connection with it (this is NOT postgrest);
--   • NOT a table owner, NOT superuser, NOT bypassrls — so it cannot read/write graph
--     rows on its own authority; every resolve downgrades to `authenticated` first;
--   • NOINHERIT — it does not silently inherit member-role privileges; it must
--     explicitly `set role authenticated` inside the resolve transaction;
--   • member of `authenticated` — so `set local role authenticated` is permitted, which
--     is exactly the role+claims context postgrest uses for user statements.
-- created idempotently; the password is assigned out of band (env secret), never in a
-- committed migration.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'projection_resolver') then
    create role projection_resolver login noinherit;
  end if;
end
$$;

-- allow the resolver role to assume the user-equivalent execution context. this grant
-- does NOT widen access: `authenticated` is itself rls-bound, and the select still runs
-- under the per-user `request.jwt.claims` set local'd in the same transaction.
grant authenticated to projection_resolver;

-- the resolver role needs schema visibility to run the compiled select; table access
-- remains governed entirely by rls under the `authenticated` role it sets local.
grant usage on schema public to projection_resolver;

comment on role projection_resolver is
  'adr-0009 resolve-query transport: non-owner, non-bypassrls login role the author server connects with to run ts-compiled projection selects; downgrades to authenticated + request.jwt.claims per resolve so rls applies as the user. never postgrest-exposed.';
