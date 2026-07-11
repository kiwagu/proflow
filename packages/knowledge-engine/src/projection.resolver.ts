import type { Database } from '@workspace/db';
import type {
  ProjectionResult,
  ProjectionSpec,
} from '@workspace/knowledge-contracts';
import { projectionResultSchema } from '@workspace/knowledge-contracts';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  compileFilter,
  createCompileCtx,
  type SqlFragment,
} from './filter.compiler.js';
import { compileTraversal } from './traversal.compiler.js';

/**
 * Projection resolver: composes the start-set + walk CTE + traverse-then-filter
 * join + order, executes it under the user's RLS, and validates the output
 * against the domain `ProjectionResult` contract.
 *
 * RLS safety: the resolve MUST run AS THE USER, NEVER service-role.
 * The resolver can only NARROW what RLS already allows.
 *
 * Transport (RATIFIED 2026-06-17, supersedes the slice-02 §8.4 open
 * item and closes P0 finding #1): the prior transport was a `security invoker`
 * RPC `resolve_projection_query(p_sql, p_params)` `grant`ed to `authenticated`.
 * Because it `execute`d caller-supplied `p_sql` behind only a `with recursive%`
 * prefix check, any authenticated user could call it via PostgREST and run
 * arbitrary read/write SQL bounded only by table RLS. That RPC is now REVOKED /
 * dropped (migration `…_revoke_resolve_projection_query_from_authenticated`).
 *
 * Instead the TS-compiled, fully-parameterized recursive-CTE SELECT is executed
 * SERVER-SIDE over a direct pg connection that adopts the requesting user's JWT
 * claims inside one explicit transaction (`SET LOCAL ROLE authenticated` +
 * `SET LOCAL request.jwt.claims`), via a dedicated non-owner / non-bypass-RLS
 * backend role. RLS is enforced natively as the user; raw SQL never crosses the
 * client→server boundary (the client sends only `projectionId`). Compilation
 * stays entirely in TS: the engine is transport-agnostic and
 * receives the execution transport by injection (`args.transport`) — it never
 * imports `pg`. The implementing transport lives in the consuming app;
 * `security definer` is forbidden (bypasses RLS).
 */

const RESOURCE_ALIAS = 'kr';

/**
 * The execution transport the engine calls with the compiled query. The `sql` is
 * the engine's own compiler output (recursive-CTE SELECT, `$1` = bound jsonb
 * param array); the implementation runs it under the user's RLS context and
 * returns the resolved rows. Injected so the engine never depends on a Postgres
 * driver — the author server supplies the pg-based transport, the
 * e2e harness supplies one built on the actor's session.
 */
export type ResolveQueryTransport = (request: {
  sql: string;
  paramsJson: unknown[];
}) => Promise<ResolveRow[]>;

type ResolveProjectionArgs = {
  projectionId: string;
  spaceId: string;
  /**
   * User JWT / RLS-scoped client — never service-role. Carried for callers that
   * still derive the resolve context from it; the actual execution goes through
   * `transport`.
   */
  db: SupabaseClient<Database>;
  /**
   * Server-side execution transport. MUST run the compiled SQL under
   * the requesting user's RLS context (`SET LOCAL ROLE authenticated` +
   * `request.jwt.claims`), never service-role.
   */
  transport: ResolveQueryTransport;
};

export function compileProjectionQuery(
  spec: ProjectionSpec,
  args: { spaceId: string }
): SqlFragment {
  const traversal = compileTraversal(spec.traversal, { spaceId: args.spaceId });

  // The projection filter compiles against the SAME param accumulator so the
  // placeholder numbering stays consistent across the whole statement.
  const filterCtx = createCompileCtx(RESOURCE_ALIAS, traversal.params);
  const filter = compileFilter(spec.filter, filterCtx);

  const orderBy = orderByClause(spec.traversal.order_by);

  // distinct on (w.node_id): a node reachable via several branches collapses to
  // one row. We keep the DEEPEST path (longest positions chain) so a node's place
  // in the prerequisite sequence is fully expressed — e.g. when every node is its
  // own start (kind=text), L3's [0,1] chain still orders it after L2's [0]. The
  // cycle-guard already bounds recursion, so "deepest" is finite.
  const sql = [
    'with recursive',
    traversal.sql,
    'select',
    `  ${RESOURCE_ALIAS}.id,`,
    `  ${RESOURCE_ALIAS}.kind,`,
    `  ${RESOURCE_ALIAS}.title,`,
    `  ${RESOURCE_ALIAS}.status,`,
    `  ${RESOURCE_ALIAS}.visibility,`,
    `  ${RESOURCE_ALIAS}.body_ref,`,
    '  ranked.depth,',
    '  ranked.via_edge_id',
    'from (',
    `  select distinct on (w.node_id)`,
    '    w.node_id, w.via_edge_id, w.depth, w.positions',
    `  from ${traversal.walkCte} w`,
    '  order by w.node_id, array_length(w.positions, 1) desc nulls last, w.depth desc',
    ') ranked',
    `join public.knowledge_resources ${RESOURCE_ALIAS} on ${RESOURCE_ALIAS}.id = ranked.node_id`,
    `where (${filter.sql})`,
    orderBy,
  ].join('\n');

  return { sql, params: filter.params };
}

function orderByClause(
  orderBy: ProjectionSpec['traversal']['order_by']
): string {
  switch (orderBy) {
    case 'created_at':
      return `order by ${RESOURCE_ALIAS}.created_at asc, ranked.depth asc`;
    case 'title':
      return `order by ${RESOURCE_ALIAS}.title asc, ranked.depth asc`;
    case 'position':
    default:
      return 'order by ranked.positions asc, ranked.depth asc';
  }
}

type ResolveRow = {
  id: string;
  kind: string;
  title: string;
  status: string;
  visibility: string;
  body_ref: unknown;
  depth: number;
  via_edge_id: string | null;
};

/**
 * Render the canonical `$n` SQL into the transport form: a single bound jsonb
 * param (`$1`) carrying the ordered value array, with each `$n` rewritten to a
 * typed jsonb extraction. This confines the transport detail to the resolver —
 * the compilers stay transport-agnostic (`$n` + values), and still zero value
 * text reaches the SQL (values live only in the jsonb param).
 *
 * `$1` is referenced as `($1::jsonb)` so the rendered SELECT is self-typed and
 * runs identically whoever binds it: the server transport binds `$1` as
 * a plain JSON string and the `::jsonb` cast lifts it to jsonb at execution
 * (the old `security invoker` RPC relied on a declared `p_params jsonb` arg for
 * the same cast; that RPC is gone).
 */
export function renderRpcQuery(fragment: SqlFragment): {
  sql: string;
  paramsJson: unknown[];
} {
  const sql = fragment.sql.replace(/\$(\d+)/g, (_match, digits: string) => {
    const oneBased = Number(digits);
    const idx = oneBased - 1; // jsonb arrays are 0-based
    const value = fragment.params[idx];
    if (Array.isArray(value)) {
      // text[] for `= any(...)`: `array(subquery)` yields the array value inline,
      // so the surrounding `any(...)` receives an array, not a scalar subquery.
      return `array(select jsonb_array_elements_text(($1::jsonb) -> ${idx}))`;
    }
    if (typeof value === 'number') {
      // `::numeric` (not `::int`): the search compiler's keyset cursor carries a
      // FUZZY `score` that is fractional (a tier-band floor + `word_similarity ∈
      // [0,1)`), so an `::int` cast would TRUNCATE it and the `score = $cursor`
      // keyset arm would never match a fuzzy row. `numeric` round-trips both the
      // integer params (limit, max_depth, prefix/exact scores) and the fractional
      // fuzzy score; `LIMIT (numeric)` and `depth < (numeric)` both coerce fine.
      return `((($1::jsonb) ->> ${idx})::numeric)`;
    }
    // scalar text (kind/status/visibility/title/id/space_id/relation_type)
    return `(($1::jsonb) ->> ${idx})`;
  });
  return { sql, paramsJson: fragment.params };
}

export async function resolveProjection(
  spec: ProjectionSpec,
  args: ResolveProjectionArgs
): Promise<ProjectionResult> {
  const fragment = compileProjectionQuery(spec, {
    spaceId: args.spaceId,
  });
  const { sql, paramsJson } = renderRpcQuery(fragment);

  // Defence-in-depth: the compiler only ever emits a
  // `with recursive … select` resolve. This is NOT the security boundary (that
  // is the REVOKE + per-user RLS transport); it guards against the engine being
  // handed a non-resolve shape by a future caller.
  if (!/^\s*with\s+recursive/i.test(sql)) {
    throw new Error(
      'resolveProjection: refusing to execute a non-resolve statement'
    );
  }

  const rows = await args.transport({ sql, paramsJson });
  // Raw literal (string ids from the DB transport); `projectionResultSchema.parse`
  // below validates the prefixes and brands the ids at this boundary.
  const result = {
    projection_id: args.projectionId,
    view: spec.view,
    items: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      status: row.status,
      visibility: row.visibility,
      body_ref: row.body_ref ?? null,
      depth: row.depth,
      via_edge_id: row.via_edge_id ?? null,
    })),
  };

  return projectionResultSchema.parse(result);
}
