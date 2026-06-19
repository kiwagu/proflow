import type { ProjectionResultItem } from '@workspace/knowledge-contracts';

import type { ContainmentEdge } from '@/app/graph/graph-page.data';

/**
 * Client-side containment traversal over the FORWARD `contains` forest (ADR-0015)
 * — the lens rail folder tree, the canvas folder browser, breadcrumb and counts.
 *
 * This is the presentation mirror of the prototype `common.jsx` KB traversal, but
 * ONLY over containment: it walks the small RLS-narrowed `contains` edge list the
 * server already loaded (`loadContainmentForest`), never the graph itself and
 * never a write. The relates_to/tagged edges of the rail/panel still come from the
 * frozen `neighborhood` engine port (ADR-0010) — containment is the one relation
 * that port does not expose, so it is read as a satellite-shaped fan-out (§7) and
 * traversed here. No domain logic leaks into the engine; this is pure mapping.
 *
 * Cycle-guard: `descendantContent`/`pathTo` bound their walk by a visited set, so
 * a malformed `contains` cycle renders bounded, never an infinite loop.
 */

/** A node as the lens browses it (subset of the resolved item — title + kind). */
export type LensNode = {
  id: string;
  kind: string;
  title: string;
};

export type Containment = {
  /** All folder/content nodes by id (resolved canvas set). */
  byId: Map<string, LensNode>;
  /** child ids by parent (folder) id, in `position` order. */
  childrenOf: Map<string, string[]>;
  /** parent (folder) id of a node, if any (single containment parent). */
  parentOf: Map<string, string>;
};

/**
 * Build the containment index from the resolved items + the `contains` forest.
 * The item set is the canvas (folders + content nodes, tags excluded server-side).
 */
export function buildContainment(
  items: ProjectionResultItem[],
  edges: ContainmentEdge[]
): Containment {
  const byId = new Map<string, LensNode>();
  for (const item of items) {
    byId.set(item.id, { id: item.id, kind: item.kind, title: item.title });
  }

  // Order child placement by edge position (stable list).
  const ordered = [...edges].sort((a, b) => a.position - b.position);
  const childrenOf = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  for (const edge of ordered) {
    // Only index edges whose endpoints are in the visible set (RLS already
    // narrowed both the items and the edges, but guard for partial visibility).
    if (!byId.has(edge.from) || !byId.has(edge.to)) {
      continue;
    }
    const siblings = childrenOf.get(edge.from);
    if (siblings) {
      siblings.push(edge.to);
    } else {
      childrenOf.set(edge.from, [edge.to]);
    }
    // first containment parent wins (a node lives in one folder, prototype-parity).
    if (!parentOf.has(edge.to)) {
      parentOf.set(edge.to, edge.from);
    }
  }
  return { byId, childrenOf, parentOf };
}

/** Direct children of a folder, as nodes (in position order). */
export function childrenNodes(c: Containment, folderId: string): LensNode[] {
  return (c.childrenOf.get(folderId) ?? [])
    .map((id) => c.byId.get(id))
    .filter((n): n is LensNode => Boolean(n));
}

/** Direct child FOLDERS of a folder. */
export function childFolders(c: Containment, folderId: string): LensNode[] {
  return childrenNodes(c, folderId).filter((n) => n.kind === 'folder');
}

/** Direct child CONTENT (non-folder, non-tag) of a folder. */
export function childContent(c: Containment, folderId: string): LensNode[] {
  return childrenNodes(c, folderId).filter(
    (n) => n.kind !== 'folder' && n.kind !== 'tag'
  );
}

/** Root folders = `kind=folder` nodes with no incoming `contains` (no parent). */
export function rootFolders(c: Containment): LensNode[] {
  const roots: LensNode[] = [];
  for (const node of c.byId.values()) {
    if (node.kind === 'folder' && !c.parentOf.has(node.id)) {
      roots.push(node);
    }
  }
  return roots.sort((a, b) => a.title.localeCompare(b.title));
}

/** Folders for a parent-folder picker (all folder nodes, by title). */
export function allFolders(c: Containment): LensNode[] {
  return [...c.byId.values()]
    .filter((n) => n.kind === 'folder')
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** The containment parent folder of a node, if any. */
export function parentFolder(c: Containment, nodeId: string): LensNode | null {
  const parentId = c.parentOf.get(nodeId);
  return parentId ? (c.byId.get(parentId) ?? null) : null;
}

/** Breadcrumb path of folders down to (and including) a folder node. */
export function pathTo(c: Containment, folderId: string): LensNode[] {
  const path: LensNode[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = folderId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = c.byId.get(cursor);
    if (node) {
      path.unshift(node);
    }
    cursor = c.parentOf.get(cursor);
  }
  return path;
}

/** Total count of content nodes (non-folder, non-tag) in the whole index
 * (prototype `contentNodes().length` for the KB rail-group counter). */
export function contentNodeCount(c: Containment): number {
  let count = 0;
  for (const node of c.byId.values()) {
    if (node.kind !== 'folder' && node.kind !== 'tag') {
      count += 1;
    }
  }
  return count;
}

/** Recursive count of content (non-folder, non-tag) under a folder. */
export function descendantContentCount(
  c: Containment,
  folderId: string
): number {
  let count = 0;
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    for (const child of childrenNodes(c, id)) {
      if (child.kind === 'folder') {
        walk(child.id);
      } else if (child.kind !== 'tag') {
        count += 1;
      }
    }
  };
  walk(folderId);
  return count;
}
