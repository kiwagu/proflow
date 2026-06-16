import type { TraversalSpec } from '@workspace/knowledge-contracts';

import {
  compileFilter,
  createCompileCtx,
  type SqlFragment,
} from './filter.compiler.js';

/**
 * Traversal compiler: a `TraversalSpec` → a recursive-CTE fragment over
 * `knowledge_edges`. Produces `start_nodes` + `walk` CTEs as a single SQL string
 * with values bound ONLY as positional `$n` params.
 *
 * Guards:
 * - depth-cap: the recursive step keeps `w.depth < $max_depth` (the zod ceiling
 *   is 16, so recursion is bounded twice over).
 * - cycle-guard: a `path` array accumulates visited nodes per branch; the step
 *   refuses to re-enter a node already in `path` (catches cycles of any length).
 * - direction: `outgoing` steps from→to; `incoming` steps to→from.
 * - `max_depth = 0` ⇒ NO traversal; only the start set is emitted.
 *
 * Execution runs under the user's RLS session, so `knowledge_edges` /
 * `knowledge_resources` rows the user cannot read never enter the walk.
 */

export type TraversalFragment = SqlFragment & {
  /** Name of the final CTE that yields (node_id, via_edge_id, depth, positions). */
  walkCte: string;
};

const RESOURCE_ALIAS = 'kr';

export function compileTraversal(
  spec: TraversalSpec,
  args: { spaceId: string; alias?: string; seedParams?: unknown[] }
): TraversalFragment {
  const ctx = createCompileCtx(args.alias ?? RESOURCE_ALIAS, args.seedParams);

  // Bind the space param once; start + walk both scope on it.
  const spaceParam = bindParam(ctx.params, args.spaceId);

  // --- start_nodes predicate ---------------------------------------------
  let startPredicate: string;
  if (spec.start.ids && spec.start.ids.length > 0) {
    startPredicate = `${ctx.alias}.id = any(${bindParam(ctx.params, spec.start.ids)})`;
  } else if (spec.start.filter) {
    // compileFilter shares the same param accumulator (ctx.params) and alias.
    const { sql } = compileFilter(spec.start.filter, ctx);
    startPredicate = sql;
  } else {
    // start: {} ⇒ all RLS-visible nodes in the space (only meaningful at depth 0)
    startPredicate = 'true';
  }

  const startNodesCte = [
    'start_nodes as (',
    `  select ${ctx.alias}.id`,
    `  from public.knowledge_resources ${ctx.alias}`,
    `  where ${ctx.alias}.space_id = ${spaceParam}`,
    `    and (${startPredicate})`,
    ')',
  ].join('\n');

  // --- walk CTE -----------------------------------------------------------
  // max_depth = 0 ⇒ no recursion: the walk is just the start set at depth 0.
  if (spec.max_depth === 0 || spec.relation_types.length === 0) {
    const walkCte = [
      'walk as (',
      '  select',
      '    sn.id            as node_id,',
      '    null::text       as via_edge_id,',
      '    0                as depth,',
      '    array[sn.id]     as path,',
      '    array[]::integer[] as positions',
      '  from start_nodes sn',
      ')',
    ].join('\n');
    return {
      sql: `${startNodesCte},\n${walkCte}`,
      params: ctx.params,
      walkCte: 'walk',
    };
  }

  const relationTypesParam = bindParam(ctx.params, spec.relation_types);
  const maxDepthParam = bindParam(ctx.params, spec.max_depth);

  // direction-dependent step columns
  const isOutgoing = spec.direction === 'outgoing';
  const stepJoinOn = isOutgoing
    ? 'e.from_id = w.node_id'
    : 'e.to_id = w.node_id';
  const nextNode = isOutgoing ? 'e.to_id' : 'e.from_id';

  const walkCte = [
    'walk as (',
    '  select',
    '    sn.id            as node_id,',
    '    null::text       as via_edge_id,',
    '    0                as depth,',
    '    array[sn.id]     as path,',
    '    array[]::integer[] as positions',
    '  from start_nodes sn',
    '  union all',
    '  select',
    `    ${nextNode}      as node_id,`,
    '    e.id             as via_edge_id,',
    '    w.depth + 1      as depth,',
    `    w.path || ${nextNode},`,
    '    w.positions || e.position',
    '  from walk w',
    '  join public.knowledge_edges e',
    `    on ${stepJoinOn}`,
    `   and e.space_id = ${spaceParam}`,
    `   and e.relation_type = any(${relationTypesParam})`,
    `  where w.depth < ${maxDepthParam}`,
    `    and not (${nextNode} = any(w.path))`,
    ')',
  ].join('\n');

  return {
    sql: `${startNodesCte},\n${walkCte}`,
    params: ctx.params,
    walkCte: 'walk',
  };
}

function bindParam(params: unknown[], value: unknown): string {
  params.push(value);
  return `$${params.length}`;
}
