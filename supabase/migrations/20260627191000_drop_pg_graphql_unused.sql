/*
 * purpose:
 *   the application uses postgrest + the knowledge resolver only; it does NOT
 *   use the graphql api. pg_graphql reflects every table into the
 *   graphql / graphql_public schemas, which the supabase security advisor flags
 *   (pg_graphql_anon_table_exposed / pg_graphql_authenticated_table_exposed).
 *   dropping the extension removes that reflection surface entirely.
 *
 * affected objects:
 *   - extension public.pg_graphql and (via cascade) the objects it owns inside
 *     the graphql / graphql_public schemas only:
 *       function graphql_public.graphql(text,text,jsonb,jsonb)
 *       functions graphql.*  (resolve, _internal_resolve, exception, comment_directive,
 *                              get_schema_version, increment_schema_version)
 *       sequence  graphql.seq_schema_version
 *       event triggers graphql_watch_ddl / graphql_watch_drop
 *   verified via pg_depend that NO object outside the graphql/graphql_public
 *   schemas depends on the extension, so the cascade is bounded to graphql state.
 *
 * special considerations:
 *   - forward-only; the graphql schemas are left in place (empty) — postgrest only
 *     exposes the schemas listed in PGRST_DB_SCHEMAS, which must drop
 *     graphql_public (infra/dev/supabase/.env.example updated to public,storage).
 *   - if the graphql api is ever needed again, re-create the extension in a new
 *     forward migration.
 */

-- destructive: removes the pg_graphql extension and the graphql reflection api.
-- bounded by pg_depend analysis to graphql/graphql_public objects only.
drop extension if exists pg_graphql cascade;
