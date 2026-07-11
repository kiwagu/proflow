import type {
  FilterLeaf,
  FilterNode,
  FilterOperator,
} from '@workspace/knowledge-contracts';

/**
 * Filter compiler: a `FilterNode` boolean AST → a parameterized SQL `WHERE`
 * fragment. Adapted from the DDD/Hexagonal reference's "filter-visitor over a
 * query-builder" pattern: the AST/contract lives in the domain (zod) layer, the
 * SQL compilation lives here in the infrastructure adapter.
 *
 * Anti-injection contract:
 * - column identifiers come ONLY from a fixed `FilterField → column-expr` map;
 *   a field outside the map throws (never "skip"). The compiler NEVER builds an
 *   identifier from a user string.
 * - VALUES are emitted ONLY as positional `$n` parameters — never interpolated
 *   into the SQL text.
 * - the op is matched against the operator allow-list; an unknown op throws.
 * - the value shape is validated per op; a wrong shape throws.
 * - every node is fully parenthesized so boolean precedence is unambiguous.
 */

export type SqlFragment = {
  sql: string;
  params: unknown[];
};

export type CompileCtx = {
  /** Table alias for the knowledge node columns (e.g. `kr`). */
  alias: string;
  /** Mutable positional-param accumulator; placeholders are `$<index>`. */
  params: unknown[];
};

export function createCompileCtx(
  alias: string,
  seedParams: unknown[] = []
): CompileCtx {
  return { alias, params: [...seedParams] };
}

// Hard allow-list: each filterable field maps to exactly ONE real scalar column.
// Variant B removed the virtual `tag` field — every entry is a real node column.
const FIELD_COLUMN: Record<string, string> = {
  kind: 'kind',
  status: 'status',
  visibility: 'visibility',
  title: 'title',
};

const ALLOWED_OPERATORS: ReadonlySet<FilterOperator> = new Set([
  'eq',
  'neq',
  'in',
  'contains',
]);

function isLeaf(node: FilterNode): node is FilterLeaf {
  return (
    typeof node === 'object' &&
    node !== null &&
    'field' in node &&
    'op' in node &&
    'value' in node
  );
}

function bind(ctx: CompileCtx, value: unknown): string {
  ctx.params.push(value);
  return `$${ctx.params.length}`;
}

function columnFor(ctx: CompileCtx, field: string): string {
  const column = FIELD_COLUMN[field];
  if (column === undefined) {
    throw new Error(`compileFilter: field not in allow-list: ${field}`);
  }
  return `${ctx.alias}.${column}`;
}

function compileLeaf(leaf: FilterLeaf, ctx: CompileCtx): string {
  if (!ALLOWED_OPERATORS.has(leaf.op)) {
    throw new Error(`compileFilter: operator not in allow-list: ${leaf.op}`);
  }
  const col = columnFor(ctx, leaf.field);

  switch (leaf.op) {
    case 'eq': {
      assertScalar(leaf);
      return `(${col} = ${bind(ctx, leaf.value)})`;
    }
    case 'neq': {
      assertScalar(leaf);
      return `(${col} is distinct from ${bind(ctx, leaf.value)})`;
    }
    case 'in': {
      if (!Array.isArray(leaf.value)) {
        throw new Error(`compileFilter: 'in' requires an array value`);
      }
      return `(${col} = any(${bind(ctx, leaf.value)}))`;
    }
    case 'contains': {
      // Variant B: the single valid meaning is a `title` substring search.
      if (leaf.field !== 'title') {
        throw new Error(
          `compileFilter: 'contains' is only valid on 'title' (got '${leaf.field}')`
        );
      }
      if (typeof leaf.value !== 'string') {
        throw new Error(`compileFilter: 'contains' requires a string value`);
      }
      // value stays a param; only the '%' literals are concatenated in SQL.
      return `(${col} ilike '%' || ${bind(ctx, leaf.value)} || '%')`;
    }
    default: {
      // exhaustive — ALLOWED_OPERATORS guards the set
      const never: never = leaf.op;
      throw new Error(`compileFilter: unhandled operator: ${String(never)}`);
    }
  }
}

function assertScalar(leaf: FilterLeaf): void {
  if (Array.isArray(leaf.value)) {
    throw new Error(`compileFilter: '${leaf.op}' requires a scalar value`);
  }
}

/**
 * Compile a `FilterNode` into a parameterized SQL fragment. The recursive
 * visitor parenthesizes every node; params are accumulated in traversal order.
 */
export function compileFilter(node: FilterNode, ctx: CompileCtx): SqlFragment {
  const sql = compileNode(node, ctx);
  return { sql, params: ctx.params };
}

function compileNode(node: FilterNode, ctx: CompileCtx): string {
  if (isLeaf(node)) {
    return compileLeaf(node, ctx);
  }
  if ('and' in node) {
    const parts = node.and.map((child) => compileNode(child, ctx));
    return `(${parts.join(' and ')})`;
  }
  if ('or' in node) {
    const parts = node.or.map((child) => compileNode(child, ctx));
    return `(${parts.join(' or ')})`;
  }
  if ('not' in node) {
    return `(not ${compileNode(node.not, ctx)})`;
  }
  throw new Error('compileFilter: unrecognized filter node shape');
}
