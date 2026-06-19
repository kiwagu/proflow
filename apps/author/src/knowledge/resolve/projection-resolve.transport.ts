import type { ResolveQueryTransport } from '@workspace/knowledge-engine';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decodeJwt } from 'jose';
import { Pool } from 'pg';

/**
 * Projection-resolve transport — server-side execution under the user's RLS
 * (ADR-0009, ratified 2026-06-17, closing P0 finding #1).
 *
 * The prior transport (`resolve_projection_query`, `security invoker`, `grant
 * execute … to authenticated`) let any authenticated user run arbitrary SQL via
 * PostgREST behind a `with recursive%` prefix guard. That RPC is now REVOKED /
 * dropped (migration `…_revoke_resolve_projection_query_from_authenticated`).
 *
 * Instead the TS-compiled, fully-parameterized recursive-CTE SELECT (produced by
 * `@workspace/knowledge-engine`) is executed here, server-side, over a DIRECT pg
 * connection that adopts the requesting user's JWT claims inside ONE explicit
 * transaction:
 *
 *     begin;
 *     set local role authenticated;                  -- the role PostgREST uses
 *     set local request.jwt.claims = <user claims>;  -- the user's own JWT claims
 *     <compiled sql>  -- executed with the bound jsonb param ($1)
 *     commit;
 *
 * The pool connects as the dedicated `projection_resolver` backend role
 * (`PROJECTION_RESOLVER_DATABASE_URL`): NON-owner, NON-bypass-RLS. The SELECT runs
 * AS THE USER (`authenticated` + claims), so Postgres RLS is the sole access
 * authority — the engine can only NARROW what RLS allows, never widen it
 * (ADR-0001/0003 §2). Raw SQL text NEVER crosses the client→server boundary: the
 * browser sends only a `projectionId`; the compiler builds the SQL on the server.
 *
 * Gotchas honoured (ADR-0009):
 *  - `SET LOCAL` lives inside a SINGLE explicit transaction on ONE pooled
 *    connection (never split across a transaction-pooled hop) — use a direct /
 *    session connection in `PROJECTION_RESOLVER_DATABASE_URL`, not the pgbouncer
 *    transaction pooler.
 *  - We do NOT rely on `SET LOCAL transaction_read_only` as a guard; read-only is
 *    guaranteed by the compiled SELECT shape and by the role having no widened
 *    grant — the security boundary is the REVOKE + per-user RLS, not a flag.
 */

let pool: Pool | undefined;

/** One narrow pool for the resolver role, lazily created and memoized. */
function resolverPool(): Pool {
  if (pool) {
    return pool;
  }
  const connectionString = process.env.PROJECTION_RESOLVER_DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      'projection-resolve transport: PROJECTION_RESOLVER_DATABASE_URL is not set'
    );
  }
  pool = new Pool({ connectionString, max: 4 });
  return pool;
}

/**
 * The claims object SET LOCAL'd into `request.jwt.claims`. It is the decoded
 * payload of the requesting user's own access-token JWT — exactly the claims
 * PostgREST would expose to RLS (`sub` → `auth.uid()`, `role`, `email`, …). We
 * decode (not verify) here: the token already arrived inside the trusted SSR
 * session the proxy validated; we only need its claims to re-establish the user's
 * RLS context on this connection.
 */
export type ResolveJwtClaims = Record<string, unknown>;

/**
 * Extract the requesting user's JWT claims from the SAME RLS-scoped Supabase
 * session that backs `db`. Throws when there is no authenticated session, so a
 * resolve can never silently run without a user context (which would yield an
 * empty/incorrect `auth.uid()`).
 */
export async function resolveJwtClaimsFromSession(
  db: SupabaseClient
): Promise<ResolveJwtClaims> {
  const { data, error } = await db.auth.getSession();
  if (error) {
    throw new Error(`projection-resolve transport: ${error.message}`);
  }
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    throw new Error(
      'projection-resolve transport: no authenticated session for resolve'
    );
  }
  return decodeJwt(accessToken) as ResolveJwtClaims;
}

/**
 * Build a `ResolveQueryTransport` bound to one user's JWT claims. The engine
 * hands it the compiled `{ sql, paramsJson }`; we run it under that user's RLS in
 * a single transaction and return the rows.
 */
export function createProjectionResolveTransport(
  claims: ResolveJwtClaims
): ResolveQueryTransport {
  const claimsJson = JSON.stringify(claims);
  return async ({ sql, paramsJson }) => {
    const client = await resolverPool().connect();
    try {
      await client.query('begin');
      // Adopt the user's PostgREST-equivalent context for the duration of this
      // transaction only (transaction-scoped, never leaks back to the pool). Order
      // matters: role first, then claims. `SET` takes no bind params, so claims go
      // through `set_config(name, value, is_local=true)` (the LOCAL equivalent).
      await client.query('set local role authenticated');
      await client.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        claimsJson,
      ]);

      // The compiled SELECT references its values exclusively through the single
      // bound jsonb param ($1) — zero value interpolation (the engine guarantees
      // this; values live only in `paramsJson`).
      const result = await client.query(sql, [JSON.stringify(paramsJson)]);
      await client.query('commit');
      return result.rows;
    } catch (err) {
      await client.query('rollback').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  };
}
