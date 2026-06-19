import type { Database } from '@workspace/db';
import type {
  NeighborhoodResult,
  NeighborhoodSpec,
} from '@workspace/knowledge-contracts';
import { neighborhoodResultSchema } from '@workspace/knowledge-contracts';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { SqlFragment } from './filter.compiler.js';
import {
  renderRpcQuery,
  type ResolveQueryTransport,
} from './projection.resolver.js';

/**
 * Neighborhood resolver: the SECOND read port over the knowledge graph
 * (docs/knowledge-graph-plan.md), orthogonal to projection resolution. It walks a
 * bounded BFS (depth ≤ 2, cycle-guarded) from ONE given center node over
 * `knowledge_edges` ⋈ `knowledge_resources`, returning a flat, RLS-narrowed
 * `neighbors[]` carrying `relation_type` + `direction` + `depth`. Grouping by
 * application meaning (related/tags) and folding `depth` into a tree are the
 * presentation layer's job — the engine stays mechanism-neutral.
 *
 * Same class as the traversal compiler (recursive CTE over `knowledge_edges`),
 * but the recursion ANCHOR is the SINGLE center node, not a filter-derived set.
 *
 * RLS safety (ADR-0009): like `resolveProjection`, the compiled SQL is executed
 * SERVER-SIDE under the requesting user's RLS context through the SAME injected
 * `ResolveQueryTransport` — never service-role. The engine never imports `pg`;
 * raw SQL never crosses the client→server boundary (the client sends only the
 * `centerId` + `max_depth`). Compilation stays entirely in TS. The transport is
 * reused as-is: the same `{ sql, paramsJson }` envelope, the same `$1::jsonb`
 * param form as `renderRpcQuery`.
 */

const RESOURCE_ALIAS = 'kr';

type ResolveNeighborhoodArgs = {
  /** knr_… — the node to expand. Passed as an arg, never part of the spec. */
  centerId: string;
  spaceId: string;
  /**
   * User JWT / RLS-scoped client — never service-role. Carried for parity with
   * `resolveProjection`; execution goes through `transport`.
   */
  db: SupabaseClient<Database>;
  /**
   * Server-side execution transport (ADR-0009) — the SAME per-user-RLS transport
   * `resolveProjection` uses. MUST run the compiled SQL under the requesting
   * user's RLS context, never service-role.
   */
  transport: ResolveQueryTransport;
};

function bindParam(params: unknown[], value: unknown): string {
  params.push(value);
  return `$${params.length}`;
}

/**
 * Compile a BOUNDED recursive CTE walking from ONE center node.
 *
 * Shape (ONE non-recursive anchor + ONE recursive term — a recursive CTE may carry
 * exactly ONE self-reference, in the recursive term):
 *   with recursive walk as (
 *     -- anchor (non-recursive): the center node at depth 0 (path seed, NOT a neighbor)
 *     select <center> as node_id, null edge_id, null relation_type, null direction,
 *            0 depth, array[<center>] path, 0 position
 *     union all
 *     -- recursive term (ONE self-reference): from any frontier node step one hop in
 *     -- the requested direction. The neighbor is the OPPOSITE end of the edge; for
 *     -- `both`, ONE term carries both sides (e.from_id = w.node_id OR e.to_id =
 *     -- w.node_id) and the per-row `direction` / neighbor are computed by `case`.
 *     -- depth < max_depth bounds it (zod already capped max_depth ≤ 2); the
 *     -- cycle-guard refuses a node already on the branch's path.
 *     select <neighbor>, e.id, e.relation_type, <direction>, w.depth + 1,
 *            w.path || <neighbor>, e.position
 *     from walk w join knowledge_edges e on <step> and e.space_id = <space>
 *                 and e.relation_type = any(<relation_types>)
 *     where w.depth < <max_depth> and not (<neighbor> = any(w.path))
 *   )
 *   -- per relation_type, per depth: keep the first <limit_per_relation> by position
 *   select … from (
 *     select …, row_number() over (
 *       partition by depth, relation_type, direction order by position, node_id
 *     ) as rn
 *     from walk where depth >= 1
 *   ) ranked join knowledge_resources kr on kr.id = ranked.node_id
 *   where ranked.rn <= <limit_per_relation>
 *   order by depth, relation_type, position
 *
 * `direction='both'` does NOT union two self-referencing branches (Postgres allows
 * only ONE recursive self-reference). Instead a SINGLE recursive term matches both
 * edge sides in its join and derives the per-row direction + neighbor via `case`.
 * Cycle-guard parity with `traversal.compiler.ts` (a `path` array per branch).
 * Values are bound ONLY as positional `$n` params — no value interpolation.
 */
export function compileNeighborhoodQuery(
  spec: NeighborhoodSpec,
  args: { centerId: string; spaceId: string }
): SqlFragment {
  const params: unknown[] = [];

  const centerParam = bindParam(params, args.centerId);
  const spaceParam = bindParam(params, args.spaceId);
  const relationTypesParam = bindParam(params, spec.relation_types);
  const maxDepthParam = bindParam(params, spec.max_depth);
  const limitParam = bindParam(params, spec.limit_per_relation);

  // The recursive term joins frontier nodes to edges in the requested direction.
  // For a single direction the step is a plain equality; for `both` it is an `OR`
  // of both sides, with the neighbor end and the traversed direction computed
  // per-row by `case`. Whatever the direction, this is ONE recursive self-reference
  // (`from walk w`) inside ONE recursive term — never two unioned self-references.
  const isBoth = spec.direction === 'both';

  // join predicate: which edge endpoint is the frontier node.
  const joinOn = isBoth
    ? '(e.from_id = w.node_id or e.to_id = w.node_id)'
    : spec.direction === 'outgoing'
      ? 'e.from_id = w.node_id'
      : 'e.to_id = w.node_id';

  // neighbor = the OPPOSITE end of the edge from the frontier node.
  const neighborExpr = isBoth
    ? 'case when e.from_id = w.node_id then e.to_id else e.from_id end'
    : spec.direction === 'outgoing'
      ? 'e.to_id'
      : 'e.from_id';

  // direction tag for the row, relative to the frontier node it was reached from.
  // For a single-direction walk it is the literal direction; for `both` it is
  // computed per-row. The literals come from the zod enum (validated before
  // compile), never from raw user input.
  const directionExpr = isBoth
    ? "case when e.from_id = w.node_id then 'outgoing' else 'incoming' end"
    : `'${spec.direction}'`;

  const recursiveTerm = [
    '  select',
    `    ${neighborExpr} as node_id,`,
    '    e.id             as edge_id,',
    '    e.relation_type  as relation_type,',
    `    ${directionExpr} as direction,`,
    '    w.depth + 1      as depth,',
    `    w.path || (${neighborExpr}) as path,`,
    '    e.position       as position',
    '  from walk w',
    '  join public.knowledge_edges e',
    `    on ${joinOn}`,
    `   and e.space_id = ${spaceParam}`,
    `   and e.relation_type = any(${relationTypesParam})`,
    `  where w.depth < ${maxDepthParam}`,
    `    and not ((${neighborExpr}) = any(w.path))`,
  ].join('\n');

  const walkCte = [
    'walk as (',
    '  select',
    `    ${centerParam}     as node_id,`,
    '    null::text       as edge_id,',
    '    null::text       as relation_type,',
    '    null::text       as direction,',
    '    0                as depth,',
    `    array[${centerParam}] as path,`,
    '    0                as position',
    '  union all',
    recursiveTerm,
    ')',
  ].join('\n');

  // per (depth, relation_type, direction): keep the first `limit_per_relation`
  // rows ordered by position (anti-DoS on hub fan-out, especially at depth 2).
  const sql = [
    'with recursive',
    walkCte,
    'select',
    '  ranked.edge_id,',
    '  ranked.relation_type,',
    '  ranked.direction,',
    '  ranked.depth,',
    '  ranked.position,',
    `  ${RESOURCE_ALIAS}.id,`,
    `  ${RESOURCE_ALIAS}.kind,`,
    `  ${RESOURCE_ALIAS}.title,`,
    `  ${RESOURCE_ALIAS}.status,`,
    `  ${RESOURCE_ALIAS}.visibility,`,
    `  ${RESOURCE_ALIAS}.body_ref`,
    'from (',
    '  select',
    '    w.node_id, w.edge_id, w.relation_type, w.direction, w.depth, w.position,',
    '    row_number() over (',
    '      partition by w.depth, w.relation_type, w.direction',
    '      order by w.position, w.node_id',
    '    ) as rn',
    '  from walk w',
    '  where w.depth >= 1',
    ') ranked',
    `join public.knowledge_resources ${RESOURCE_ALIAS} on ${RESOURCE_ALIAS}.id = ranked.node_id`,
    `where ranked.rn <= ${limitParam}`,
    'order by ranked.depth asc, ranked.relation_type asc, ranked.position asc',
  ].join('\n');

  return { sql, params };
}

type NeighborhoodRow = {
  edge_id: string;
  relation_type: string;
  direction: 'outgoing' | 'incoming';
  depth: number;
  position: number;
  id: string;
  kind: string;
  title: string;
  status: string;
  visibility: string;
  body_ref: unknown;
};

export async function resolveNeighborhood(
  spec: NeighborhoodSpec,
  args: ResolveNeighborhoodArgs
): Promise<NeighborhoodResult> {
  const fragment = compileNeighborhoodQuery(spec, {
    centerId: args.centerId,
    spaceId: args.spaceId,
  });
  const { sql, paramsJson } = renderRpcQuery(fragment);

  // Defence-in-depth (parity with resolveProjection): the compiler only ever
  // emits a `with recursive … select` walk. This is NOT the security boundary
  // (per-user RLS transport is) — it guards against a future caller handing the
  // engine a non-walk shape.
  if (!/^\s*with\s+recursive/i.test(sql)) {
    throw new Error(
      'resolveNeighborhood: refusing to execute a non-walk statement'
    );
  }

  // The injected transport is typed against the projection row shape; a
  // neighborhood walk returns a different column set, so re-type via `unknown`.
  // The runtime contract is the same `{ sql, paramsJson }` envelope (ADR-0009),
  // and the output is validated against `neighborhoodResultSchema` below.
  const rows = (await args.transport({
    sql,
    paramsJson,
  })) as unknown as NeighborhoodRow[];

  const result: NeighborhoodResult = {
    center_id: args.centerId,
    neighbors: rows.map((row) => ({
      edge_id: row.edge_id,
      relation_type: row.relation_type,
      direction: row.direction,
      depth: row.depth,
      node: {
        id: row.id,
        kind: row.kind,
        title: row.title,
        status: row.status,
        visibility: row.visibility,
        body_ref: row.body_ref ?? null,
      },
      position: row.position,
    })),
  };

  return neighborhoodResultSchema.parse(result);
}
