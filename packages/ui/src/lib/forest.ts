/**
 * Generic forest — a domain-agnostic parent/child index built from a flat list of
 * nodes + directed position-ordered `{ from → to }` edges. It knows NOTHING about
 * what a node is; callers specialize it (e.g. a knowledge-graph containment forest
 * over `contains` edges). Single-parent index (`parentOf` keeps the first parent),
 * mirroring a tree/breadcrumb model. Traversals are cycle-guarded (a malformed
 * cycle renders bounded, never an infinite loop).
 */

export type ForestEdge = { from: string; to: string; position: number };

export type Forest<N> = {
  /** All nodes by id. */
  byId: Map<string, N>;
  /** Child ids by parent id, in `position` order. */
  childrenOf: Map<string, string[]>;
  /** First parent of a node, if any (single-parent index). */
  parentOf: Map<string, string>;
};

export function buildForest<N extends { id: string }>(
  nodes: readonly N[],
  edges: readonly ForestEdge[]
): Forest<N> {
  const byId = new Map<string, N>();
  for (const node of nodes) {
    byId.set(node.id, node);
  }

  const ordered = [...edges].sort((a, b) => a.position - b.position);
  const childrenOf = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  for (const edge of ordered) {
    // Only index edges whose endpoints are both present (callers may pass a
    // partially-visible set — e.g. RLS-narrowed — so guard).
    if (!byId.has(edge.from) || !byId.has(edge.to)) {
      continue;
    }
    const kids = childrenOf.get(edge.from);
    if (kids) {
      kids.push(edge.to);
    } else {
      childrenOf.set(edge.from, [edge.to]);
    }
    // first parent wins (a node lives under one parent in the tree projection).
    if (!parentOf.has(edge.to)) {
      parentOf.set(edge.to, edge.from);
    }
  }
  return { byId, childrenOf, parentOf };
}

/** Direct children of a node, as nodes (in `position` order). */
export function forestChildren<N>(forest: Forest<N>, parentId: string): N[] {
  return (forest.childrenOf.get(parentId) ?? [])
    .map((id) => forest.byId.get(id))
    .filter((node): node is N => node !== undefined);
}

/** Path from the root down to (and including) `nodeId` — the breadcrumb trail. */
export function forestPath<N>(forest: Forest<N>, nodeId: string): N[] {
  const path: N[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = nodeId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = forest.byId.get(cursor);
    if (node) {
      path.unshift(node);
    }
    cursor = forest.parentOf.get(cursor);
  }
  return path;
}
