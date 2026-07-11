/**
 * E2E mirror of the author server's projection-resolve transport.
 *
 * The production resolve path runs the TS-compiled, parameterized recursive-CTE
 * SELECT server-side over a direct pg connection that adopts the user's JWT
 * claims inside one transaction (`SET LOCAL ROLE authenticated` + `SET LOCAL
 * request.jwt.claims`). The knowledge e2e suites call `resolveProjection`
 * directly, so they supply the SAME transport shape here — proving the new
 * transport keeps RLS fidelity (granted user sees their set, ungranted sees
 * none) and that no raw SQL is needed from the client.
 *
 * Connection: `PROJECTION_RESOLVER_DATABASE_URL` (the dedicated `projection_resolver`
 * role) when provided; otherwise the dev direct Postgres URL composed from the
 * infra stack. EITHER way the resolve downgrades to `authenticated` + the actor's
 * own claims inside the transaction, so the SELECT runs AS THE USER and RLS is
 * the sole access authority — exactly the property the security acceptance test
 * needs to hold.
 */
import type { ResolveQueryTransport } from '@workspace/knowledge-engine';
import type { SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | undefined;

function resolverDatabaseUrl(): string {
  const explicit =
    process.env.PROJECTION_RESOLVER_DATABASE_URL?.trim() ||
    process.env.E2E_RESOLVER_DATABASE_URL?.trim();
  if (explicit) {
    return explicit;
  }
  // Dev fallback: the direct (session-mode) Postgres connection of the local
  // self-hosted stack. NOT the transaction pooler — SET LOCAL must stay on one
  // connection inside the explicit transaction (gotcha).
  const host = process.env.E2E_DB_HOST?.trim() || '127.0.0.1';
  const port = process.env.E2E_DB_PORT?.trim() || '54322';
  const user = process.env.E2E_DB_USER?.trim() || 'postgres';
  const password = process.env.E2E_DB_PASSWORD?.trim();
  const database = process.env.E2E_DB_NAME?.trim() || 'postgres';
  if (!password) {
    throw new Error(
      'projection-resolve transport (e2e): set PROJECTION_RESOLVER_DATABASE_URL ' +
        'or E2E_DB_PASSWORD to reach the local Postgres for resolve execution'
    );
  }
  return `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

function resolverPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({ connectionString: resolverDatabaseUrl(), max: 4 });
  }
  return pool;
}

/** Close the shared pool (call from suite teardown). */
export async function closeResolveTransportPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

/** Decode (NOT verify) a JWT payload into its claims object. */
function decodeClaims(accessToken: string): Record<string, unknown> {
  const payload = accessToken.split('.')[1];
  if (!payload) {
    throw new Error(
      'projection-resolve transport (e2e): malformed access token'
    );
  }
  const json = Buffer.from(payload, 'base64url').toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}

/**
 * Build a `ResolveQueryTransport` for an authenticated actor client — lifts the
 * actor's JWT claims from its current session, then runs each compiled resolve
 * under `authenticated` + those claims in a single transaction.
 */
export async function transportForActor(
  client: SupabaseClient
): Promise<ResolveQueryTransport> {
  const { data, error } = await client.auth.getSession();
  if (error) {
    throw new Error(`projection-resolve transport (e2e): ${error.message}`);
  }
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    throw new Error(
      'projection-resolve transport (e2e): actor has no active session'
    );
  }
  const claimsJson = JSON.stringify(decodeClaims(accessToken));

  return async ({ sql, paramsJson }) => {
    const conn = await resolverPool().connect();
    try {
      await conn.query('begin');
      await conn.query('set local role authenticated');
      // `SET` takes no bind params; `set_config(name, value, is_local=true)` is the
      // transaction-scoped (LOCAL) equivalent and binds the claims json safely.
      await conn.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        claimsJson,
      ]);
      const result = await conn.query(sql, [JSON.stringify(paramsJson)]);
      await conn.query('commit');
      return result.rows;
    } catch (err) {
      await conn.query('rollback').catch(() => {});
      throw err;
    } finally {
      conn.release();
    }
  };
}
