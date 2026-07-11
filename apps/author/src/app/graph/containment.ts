import type { ProjectionResultItem } from '@workspace/knowledge-contracts';
import { byText } from '@workspace/ui/lib/sort';
import {
  buildForest,
  forestChildren,
  forestPath,
  type Forest,
} from '@workspace/ui/lib/forest';

import type { ContainmentEdge } from '@/app/graph/graph-data.types';

/**
 * KB containment — the knowledge-graph specialization of the generic forest
 * (`@workspace/ui/lib/forest`) over the FORWARD `contains` forest: the
 * Drive folder tree, the canvas browser, breadcrumb and per-folder counts. The
 * generic mechanism (build / children / path) lives in `ui/lib`; the KB-domain bits
 * (the `folder`/`tag` kind predicates, the `LensNode` shape) live HERE. SHARED by
 * every graph view — not owned by any one view.
 *
 * Pure mapping over the small RLS-narrowed `contains` edge list the server loaded —
 * never the graph itself, never a write.
 */

/** A node as the views browse it (subset of the resolved item — title + kind). */
export type LensNode = {
  id: string;
  kind: string;
  title: string;
  /** The node's workflow status (`draft`/`active`/`archived`).
   * Optional: only the Drive canvas (`buildContainment` over resolved items) carries
   * it; ad-hoc LensNodes built elsewhere (search hits) omit it. Drives the client-side
   * status facet — a content-lifecycle filter, the sibling of the "Only files" toggle. */
  status?: string;
};

export type Containment = Forest<LensNode>;

/** Build the containment index from the resolved items + the `contains` forest. */
export function buildContainment(
  items: ProjectionResultItem[],
  edges: ContainmentEdge[]
): Containment {
  return buildForest(
    items.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      status: item.status,
    })),
    edges
  );
}

/** Direct child FOLDERS of a folder. */
export function childFolders(c: Containment, folderId: string): LensNode[] {
  return forestChildren(c, folderId).filter((n) => n.kind === 'folder');
}

/** Direct child CONTENT (non-folder, non-tag) of a folder. */
export function childContent(c: Containment, folderId: string): LensNode[] {
  return forestChildren(c, folderId).filter(
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
  return roots.sort(byText((node: LensNode) => node.title));
}

/**
 * Root CONTENT = non-folder/non-tag nodes with no incoming `contains` (loose at
 * the top level, not filed under any folder). The Drive root lists these next to
 * the root folders — the "My Drive" shape (folders + loose files), so a document
 * created without a folder is visible at root, not only via a flat lens.
 */
export function rootContent(c: Containment): LensNode[] {
  const roots: LensNode[] = [];
  for (const node of c.byId.values()) {
    if (
      node.kind !== 'folder' &&
      node.kind !== 'tag' &&
      !c.parentOf.has(node.id)
    ) {
      roots.push(node);
    }
  }
  return roots.sort(byText((node: LensNode) => node.title));
}

/** Folders for a parent-folder picker (all folder nodes, by title). */
export function allFolders(c: Containment): LensNode[] {
  return [...c.byId.values()]
    .filter((n) => n.kind === 'folder')
    .sort(byText((node: LensNode) => node.title));
}

/** Breadcrumb path of folders from the root down to (and including) `folderId`. */
export function pathTo(c: Containment, folderId: string): LensNode[] {
  return forestPath(c, folderId);
}

/**
 * The ancestor folders of a node, NEAREST-first (its immediate parent, then up to the
 * root). Unlike {@link pathTo} — which is root→node and includes the node itself for
 * the breadcrumb — this excludes the node and orders from the node OUTWARD, so the
 * "nearest granted ancestor" is the FIRST match. Drives the access-mirror inheritance
 * walk: `pathTo` minus the node, reversed.
 */
export function ancestorsOf(c: Containment, nodeId: string): LensNode[] {
  const path = forestPath(c, nodeId);
  // forestPath is [root, …, node]; drop the node itself and reverse to nearest-first.
  return path.slice(0, -1).reverse();
}

/**
 * The access-mirror predicate — the SINGLE source of "who can read this"
 * for BOTH the Drive card badge (§7a) and the ResourcePanel Access summary (§7b), so
 * the two read surfaces can never diverge from each other or from the server access
 * predicate. A node is shown-as-shared IFF someone other than the owner can read it,
 * which for the owner's own client view is:
 *
 *   directly granted (`id ∈ sharedByMe`)  OR  an ANCESTOR folder is granted
 *   (the inheritance chain — the client walk over the SAME loaded `contains` forest the
 *   server admitted, owner-scoped implicitly because `sharedByMe` only holds the owner's
 *   own grants and the forest is RLS-narrowed).
 *
 * `granted` is the membership test over `sharedByMe` (a `Set`/`Map` `.has`). Returns the
 * verdict plus the NEAREST granted ancestor (null when the node is granted directly OR
 * not shared at all) so the panel can name "Inherited from {folder}".
 */
export type SharedOut = {
  /** True iff the node OR a granted ancestor is shared (the badge predicate). */
  isShared: boolean;
  /** True iff the node has its OWN direct grant (`id ∈ sharedByMe`). */
  direct: boolean;
  /** The nearest granted ANCESTOR folder, when access is (also) inherited — else null. */
  inheritedFrom: LensNode | null;
};

export function sharedOut(
  c: Containment,
  nodeId: string,
  granted: (id: string) => boolean
): SharedOut {
  const direct = granted(nodeId);
  const inheritedFrom =
    ancestorsOf(c, nodeId).find((ancestor) => granted(ancestor.id)) ?? null;
  return {
    isShared: direct || inheritedFrom != null,
    direct,
    inheritedFrom,
  };
}

/**
 * The BROADCAST half of the access-mirror (the globe state) — the SIBLING of
 * {@link sharedOut}, kept parallel + co-located so the two predicates can never drift. A
 * node is BROADCAST when its EFFECTIVE visibility floor is `space` or `organization`:
 * either its OWN `visibility` is on a broadcast floor, OR — per floor inheritance — an
 * OWNER-SCOPED ancestor folder is on a broadcast floor (a node dropped into a space/org
 * folder is auto-broadcast to the whole scope). The walk reuses the SAME `ancestorsOf`
 * forest `sharedOut` walks; owner-scope is implicit because the forest is RLS-narrowed to
 * the owner's own client view (parity with `sharedOut`'s `sharedByMe` membership).
 *
 * `floorOf` reads the node/ancestor's broadcast floor (a `'space' | 'organization'` =
 * broadcast, anything else not). Returns the verdict plus the broadcast SCOPE (own vs the
 * inheriting folder) so the panel can name "Broadcast via folder {X}" — parallel to
 * `sharedOut`'s "Inherited from {folder}".
 */
export type BroadcastOut = {
  /** True iff the node OR a broadcast-floor ancestor puts it on a space/org floor. */
  isBroadcast: boolean;
  /** The node's OWN floor is `space`/`organization` (vs only inherited). */
  direct: boolean;
  /** The broadcast SCOPE (`'space' | 'organization'`) — the node's own, else the
   * inheriting folder's; null when not broadcast. Names the globe tooltip's scope. */
  scope: 'space' | 'organization' | null;
  /** The nearest broadcast-floor ANCESTOR folder, when broadcast is (also) inherited —
   * else null (own floor or not broadcast). Names "Broadcast via folder {X}". */
  broadcastVia: LensNode | null;
};

/** Whether a floor value broadcasts (space/organization). `null`/`private` = not. */
function isBroadcastFloor(
  floor: 'private' | 'space' | 'organization' | null | undefined
): floor is 'space' | 'organization' {
  return floor === 'space' || floor === 'organization';
}

export function broadcastOut(
  c: Containment,
  nodeId: string,
  floorOf: (
    id: string
  ) => 'private' | 'space' | 'organization' | null | undefined
): BroadcastOut {
  const ownFloor = floorOf(nodeId);
  if (isBroadcastFloor(ownFloor)) {
    return {
      isBroadcast: true,
      direct: true,
      scope: ownFloor,
      broadcastVia: null,
    };
  }
  const broadcastVia =
    ancestorsOf(c, nodeId).find((ancestor) =>
      isBroadcastFloor(floorOf(ancestor.id))
    ) ?? null;
  const inheritedFloor = broadcastVia ? floorOf(broadcastVia.id) : null;
  return {
    isBroadcast: broadcastVia != null,
    direct: false,
    scope: isBroadcastFloor(inheritedFloor) ? inheritedFloor : null,
    broadcastVia,
  };
}
