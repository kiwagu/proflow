import type { Database, Json } from '@workspace/db';
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
 * join + order, executes it under the user's RLS-scoped client, and validates
 * the output against the domain `ProjectionResult` contract.
 *
 * RLS safety (ADR-0003 §2): `db` MUST be the user's JWT-scoped Supabase client,
 * NEVER service-role. The resolver can only NARROW what RLS already allows — it
 * runs the whole resolve as one query under the caller's session.
 *
 * Transport (§8.4 decision): supabase-js cannot run arbitrary text SQL, and the
 * harness has no raw Postgres connection for the `SET LOCAL request.jwt.claims`
 * route (option c). We use option (b): a narrow `security invoker` RPC
 * (`resolve_projection_query`) that EXECUTEs the TS-compiled, fully-parameterized
 * SQL as the CALLER, so RLS is enforced natively. The allow-list stays entirely
 * in TS (this is the only SQL the RPC ever runs); values travel as positional
 * params. `security definer` is forbidden (it would bypass RLS).
 */

const RESOURCE_ALIAS = 'kr';

const RPC_NAME = 'resolve_projection_query';

type ResolveProjectionArgs = {
  projectionId: string;
  spaceId: string;
  // user JWT / RLS-scoped client — never service-role
  db: SupabaseClient<Database>;
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
 * Render the canonical `$n` SQL into the transport form the RPC executes: a
 * single bound jsonb param (`$1`) carrying the ordered value array, with each
 * `$n` rewritten to a typed jsonb extraction. This confines the transport detail
 * to the resolver — the compilers stay transport-agnostic (`$n` + values), and
 * still zero value text reaches the SQL (values live only in the jsonb param).
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
      return `array(select jsonb_array_elements_text($1 -> ${idx}))`;
    }
    if (typeof value === 'number') {
      return `(($1 ->> ${idx})::int)`;
    }
    // scalar text (kind/status/visibility/title/id/space_id/relation_type)
    return `($1 ->> ${idx})`;
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

  const { data, error } = await args.db.rpc(RPC_NAME, {
    p_sql: sql,
    p_params: paramsJson as unknown as Json,
  });

  if (error) {
    throw new Error(`resolveProjection: ${error.message}`);
  }

  const rows = (data ?? []) as ResolveRow[];
  const result: ProjectionResult = {
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
