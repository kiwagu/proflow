import type { Neighbor } from '@workspace/knowledge-contracts';

import type { Containment } from './lens-containment';
import { pathTo } from './lens-containment';

/**
 * Graph-view layout math — ported 1:1 from the prototype `GraphView.jsx`
 * (slice-11 Ф5, ADR-0014 `view='graph'`). PURE geometry: BFS ego layout (radial
 * sunburst), force-directed cluster layout, and the client adjacency assembly.
 *
 * GRAPH DATA IS NEVER MOCKED. The adjacency the layout walks is assembled from
 * RLS-backed sources only:
 *  - `relates_to` ⊕ `tagged` come from the frozen `neighborhood` engine port
 *    (ADR-0010, `dir=both`), fetched per focus by the view;
 *  - `contains` / `shortcut` come from the server-loaded RLS-scoped forests
 *    (`kbData.containment` / `kbData.shortcuts`) — the SAME satellite-shaped
 *    fan-out the lens/drive views read (the neighborhood port does not expose
 *    containment, ADR-0010). The view merges them into one adjacency, mirroring
 *    the prototype `neighborsOf` (which walked every edge regardless of rel).
 *
 * Only the LAYOUT (radial ego / force sim / clustering) is client-side — topology
 * ≠ geometry (slice-11 §5 gap 4). Depth > 2 is reached by RE-CENTER, not a deep
 * fetch (engine-gap 1): clicking a neighbor refocuses and refetches its bounded
 * neighborhood. Global overview clustering is client aggregation over the already
 * RLS-resolved set (engine-gap 2). Zero engine change; the engine stays frozen.
 */

/** A presentation relation bucket (prototype `EDGE_STYLE` keys). */
export type GraphRel = 'associative' | 'contains' | 'shortcut' | 'tagged';

/** A node as the graph canvas draws it. */
export type GraphNode = {
  id: string;
  kind: string;
  title: string;
};

/** One undirected adjacency entry: a neighbor + how it is linked. */
export type GraphAdjacency = {
  node: GraphNode;
  rel: GraphRel;
};

/**
 * Build the undirected adjacency map of a node from the RLS-backed sources.
 * `relates_to` → associative, `tagged` → tagged (prototype REL mapping); the
 * containment + shortcut forests add `contains` / `shortcut`. First rel per
 * neighbor wins (prototype `neighborsOf` Map semantics).
 */
export function adjacencyOf(
  id: string,
  neighbors: Neighbor[],
  containment: Containment,
  shortcutPairs: ReadonlyArray<{ from: string; to: string }>
): GraphAdjacency[] {
  const seen = new Map<string, GraphRel>();
  const order: string[] = [];
  const add = (nid: string, rel: GraphRel) => {
    if (nid === id || seen.has(nid)) {
      return;
    }
    seen.set(nid, rel);
    order.push(nid);
  };

  // relates_to / tagged from the neighborhood port (already centred on `id`).
  for (const neighbor of neighbors) {
    const rel: GraphRel =
      neighbor.relation_type === 'tagged' ? 'tagged' : 'associative';
    add(neighbor.node.id, rel);
  }

  // contains — both directions (a folder's children AND a node's parent folder).
  for (const child of containment.childrenOf.get(id) ?? []) {
    add(child, 'contains');
  }
  const parent = containment.parentOf.get(id);
  if (parent) {
    add(parent, 'contains');
  }

  // shortcut — both directions (Drive cross-folder symlink).
  for (const pair of shortcutPairs) {
    if (pair.from === id) {
      add(pair.to, 'shortcut');
    } else if (pair.to === id) {
      add(pair.from, 'shortcut');
    }
  }

  return order
    .map((nid) => {
      const node = containment.byId.get(nid);
      return node ? { node, rel: seen.get(nid) as GraphRel } : null;
    })
    .filter((x): x is GraphAdjacency => x !== null);
}

export type EgoPosition = {
  x: number;
  y: number;
  level: number;
  rel: GraphRel | null;
};

export type EgoEdge = { from: string; to: string; rel: GraphRel };

export type EgoLayout = {
  pos: Record<string, EgoPosition>;
  edges: EgoEdge[];
  level: Record<string, number>;
  maxLevel: number;
};

/**
 * Radial ego layout — BFS tree from the focus out to `depth`, angular sectors
 * sized by leaf-count (sunburst style) so branches don't collide. Ported 1:1
 * from `egoLayout` in the prototype (same ring step, same angle assignment).
 *
 * `adjacency(id)` returns the undirected neighbors of a node (RLS-backed); the
 * caller wires it over the loaded neighborhood + forests. `pass` filters nodes by
 * the active facets (folders/tags always pass — prototype-parity).
 */
export function egoLayout(
  focusId: string,
  depth: number,
  cx: number,
  cy: number,
  ringStep: number,
  adjacency: (id: string) => GraphAdjacency[],
  pass: (node: GraphNode) => boolean
): EgoLayout {
  const visited = new Set<string>([focusId]);
  const children: Record<string, string[]> = { [focusId]: [] };
  const level: Record<string, number> = { [focusId]: 0 };
  const relOf: Record<string, GraphRel> = {};
  let frontier = [focusId];

  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const pid of frontier) {
      for (const { node, rel } of adjacency(pid)) {
        if (!visited.has(node.id) && pass(node)) {
          visited.add(node.id);
          (children[pid] = children[pid] ?? []).push(node.id);
          children[node.id] = children[node.id] ?? [];
          relOf[node.id] = rel;
          level[node.id] = d + 1;
          next.push(node.id);
        }
      }
    }
    frontier = next;
  }

  const leaves: Record<string, number> = {};
  const countLeaves = (id: string): number => {
    const ch = children[id] ?? [];
    leaves[id] =
      ch.length === 0 ? 1 : ch.reduce((s, c) => s + countLeaves(c), 0);
    return leaves[id];
  };
  countLeaves(focusId);

  const pos: Record<string, EgoPosition> = {
    [focusId]: { x: cx, y: cy, level: 0, rel: null },
  };
  const assign = (id: string, a0: number, a1: number) => {
    const ch = children[id] ?? [];
    let a = a0;
    for (const c of ch) {
      const span = (a1 - a0) * (leaves[c] / leaves[id]);
      const mid = a + span / 2;
      const r = level[c] * ringStep;
      pos[c] = {
        x: cx + Math.cos(mid) * r,
        y: cy + Math.sin(mid) * r,
        level: level[c],
        rel: relOf[c],
      };
      assign(c, a, a + span);
      a += span;
    }
  };
  assign(focusId, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2);

  const edges: EgoEdge[] = [];
  for (const pid of Object.keys(children)) {
    for (const cid of children[pid] ?? []) {
      edges.push({ from: pid, to: cid, rel: relOf[cid] });
    }
  }
  return { pos, edges, level, maxLevel: depth };
}

export type ForceArea = { x0: number; y0: number; x1: number; y1: number };

export type ForcePosition = { x: number; y: number; vx: number; vy: number };

/**
 * Force-directed layout for the global clustered overview — ported 1:1 from
 * `forceLayout` (same Fruchterman–Reingold constants: repulsion `k`, attraction
 * `0.011`, velocity clamp ±18, cooling, damping `0.85`). Deterministic: nodes seed
 * on a circle by index, no randomness, so re-renders are stable.
 */
export function forceLayout(
  nodes: ReadonlyArray<{ id: string }>,
  edges: ReadonlyArray<{ from: string; to: string }>,
  area: ForceArea,
  iters: number,
  margin: number
): Record<string, ForcePosition> {
  const { x0, y0, x1, y1 } = area;
  const w = x1 - x0;
  const h = y1 - y0;
  const ccx = x0 + w / 2;
  const ccy = y0 + h / 2;
  const pos: Record<string, ForcePosition> = {};
  nodes.forEach((n, i) => {
    const a = (i / nodes.length) * Math.PI * 2;
    pos[n.id] = {
      x: ccx + Math.cos(a) * Math.min(w, h) * 0.34,
      y: ccy + Math.sin(a) * Math.min(w, h) * 0.34,
      vx: 0,
      vy: 0,
    };
  });
  const k = Math.sqrt((w * h) / Math.max(nodes.length, 1)) * 0.78;
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = pos[nodes[i].id];
        const b = pos[nodes[j].id];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const f = (k * k) / d;
        const ux = dx / d;
        const uy = dy / d;
        a.vx += ux * f;
        a.vy += uy * f;
        b.vx -= ux * f;
        b.vy -= uy * f;
      }
    }
    for (const e of edges) {
      const a = pos[e.from];
      const b = pos[e.to];
      if (!a || !b) {
        continue;
      }
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const f = (d * d) / k;
      const ux = dx / d;
      const uy = dy / d;
      a.vx -= ux * f * 0.011;
      a.vy -= uy * f * 0.011;
      b.vx += ux * f * 0.011;
      b.vy += uy * f * 0.011;
    }
    const cool = 1 - it / iters;
    for (const n of nodes) {
      const p = pos[n.id];
      p.x += Math.max(-18, Math.min(18, p.vx)) * cool;
      p.y += Math.max(-18, Math.min(18, p.vy)) * cool;
      p.vx *= 0.85;
      p.vy *= 0.85;
      p.x = Math.max(x0 + margin, Math.min(x1 - margin, p.x));
      p.y = Math.max(y0 + margin, Math.min(y1 - margin, p.y));
    }
  }
  return pos;
}

/** A cluster in the global overview (prototype `clusters`). */
export type GraphCluster = {
  id: string;
  label: string;
  isTags: boolean;
  count: number;
  members: GraphNode[];
};

export type ClusterEdge = { from: string; to: string; w: number };

export type ClusterLayout = {
  list: GraphCluster[];
  cedges: ClusterEdge[];
  pos: Record<string, ForcePosition>;
};

/**
 * Client-side global clustering (engine-gap 2, slice-11 §5) — groups the already
 * RLS-resolved set by its top-level containment folder (`pathTo[0]`), tags into a
 * single "Tags" cluster, force-lays the clusters with cross-section link weights.
 * Ported 1:1 from the prototype `clusters` memo. Pure aggregation over the loaded
 * set — no new query, no engine change. Edge counting uses the same RLS-backed
 * adjacency the ego layout uses.
 */
export function clusterLayout(
  nodes: GraphNode[],
  containment: Containment,
  edgePairs: ReadonlyArray<{ from: string; to: string }>,
  area: ForceArea,
  pass: (node: GraphNode) => boolean,
  tagsLabel: string,
  otherLabel: string
): ClusterLayout {
  const clusterOf = (id: string): string | null => {
    const n = containment.byId.get(id);
    if (!n) {
      return null;
    }
    if (n.kind === 'tag') {
      return '__tags';
    }
    const path = pathTo(containment, id);
    return path[0] ? path[0].id : id;
  };

  const map: Record<string, GraphCluster> = {};
  for (const n of nodes) {
    if (!pass(n)) {
      continue;
    }
    const c = clusterOf(n.id);
    if (!c) {
      continue;
    }
    if (!map[c]) {
      const isTags = c === '__tags';
      map[c] = {
        id: c,
        label: isTags
          ? tagsLabel
          : (containment.byId.get(c)?.title ?? otherLabel),
        isTags,
        count: 0,
        members: [],
      };
    }
    map[c].count += 1;
    map[c].members.push(n);
  }
  const list = Object.values(map);

  const wmap: Record<string, number> = {};
  for (const e of edgePairs) {
    const fromNode = containment.byId.get(e.from);
    const toNode = containment.byId.get(e.to);
    if (!fromNode || !toNode || !pass(fromNode) || !pass(toNode)) {
      continue;
    }
    const a = clusterOf(e.from);
    const b = clusterOf(e.to);
    if (!a || !b || a === b || !map[a] || !map[b]) {
      continue;
    }
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    wmap[key] = (wmap[key] ?? 0) + 1;
  }
  const cedges: ClusterEdge[] = Object.keys(wmap).map((k) => {
    const [from, to] = k.split('|');
    return { from, to, w: wmap[k] };
  });

  const pos = forceLayout(list, cedges, area, 260, 70);
  return { list, cedges, pos };
}

/** prototype EDGE_STYLE — stroke token + opacity + dash by relation. */
export const EDGE_STYLE: Record<
  GraphRel,
  { stroke: string; opacity: number; dash?: string }
> = {
  associative: { stroke: 'var(--foreground)', opacity: 0.55 },
  contains: { stroke: 'var(--muted-foreground)', opacity: 0.5 },
  shortcut: { stroke: 'var(--muted-foreground)', opacity: 0.5, dash: '6 4' },
  tagged: { stroke: 'var(--muted-foreground)', opacity: 0.7, dash: '3 4' },
};
