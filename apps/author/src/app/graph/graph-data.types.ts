/**
 * Presentation-side data types for the `/author/graph/*` render surface. These
 * shapes ride ALONGSIDE the frozen `ProjectionResult` contract (schema_version=1)
 * — the KB satellite attributes, node meta, and the containment/shortcut forests
 * are needed only by the card surfaces, so they are loaded as presentation
 * fan-outs rather than extending the contract.
 *
 * Extracted as TYPE-ONLY definitions (no server imports) so a client view can
 * consume them without dragging the server data loaders into the client bundle.
 */

/**
 * One `contains` edge (folder → child) as the Drive view reads it. `from` is the
 * container folder, `to` the child node (FORWARD per ADR-0015).
 */
export type ContainmentEdge = {
  from: string; // knr_… of the folder
  to: string; // knr_… of the child (folder or content node)
  position: number;
};

/**
 * One `shortcut` edge (folder → target) as the Drive view reads it (ADR-0015 §3).
 * FORWARD direction `from`=folder, `to`=target. A cross-folder symlink: rendered
 * ONLY in Drive, EXCLUDED from containment traversal, so it never forms a cycle.
 */
export type ShortcutEdge = {
  from: string; // knr_… of the source folder
  to: string; // knr_… of the target (folder or content node)
  position: number;
};

/** KB application attributes of ONE node, as the Drive cards read them. */
export type KbAttributes = {
  /** RAG-bound description text (editable, stored). Absent → never set. */
  description?: string;
  /** Provenance source of the node. Absent → defaults to human in the view. */
  provenance?: 'human' | 'imported' | 'ai';
  /** External URL + host for `kind=link`. */
  link?: { url: string; host: string | null };
  /** File size / video duration / mime for `kind=file|video`. */
  media?: {
    byteSize: number | null;
    durationMs: number | null;
    mimeType: string | null;
  };
  /** Real view counter (server-incremented on open). */
  viewCount?: number;
};

/** Node owner + timestamp the Drive meta line needs but the FROZEN
 * `ProjectionResultItem` contract does not carry (`schema_version`=1). The "Recent"
 * filter sorts by the PER-USER `last_opened_at` overlay (loaded separately). */
export type NodeMeta = {
  ownerUserId: string | null;
  /** Last MODIFICATION (cross-store: node row + body + satellite + edge, EXCLUDING
   * mere views), maintained by the recency roll-up (ADR-0016). Drives the "Modified"
   * column — distinct from the node row's raw `updated_at`, which misses body/satellite
   * edits, and from `last_activity_at`, which also counts opens. */
  lastModifiedAt: string;
};

/**
 * The CURRENT user's space-level knowledge verbs, resolved ONCE per space (the
 * verdict is constant across every node in the space — `auth_user_can_access_in_space`
 * is space+verb, never per-node). The `⋯` node-actions menu combines these with
 * per-node ownership to DISPLAY-GATE its items (ADR-0006: gating = display). This is
 * fail-SAFE UX, NEVER the security boundary — Postgres RLS remains the sole authority;
 * hiding an item the user cannot perform only spares them a silent no-op route hit.
 *
 * Mirrors the `knowledge_resources` write/delete RLS predicate exactly:
 *   canModify(node) = node.ownerUserId === me || canUpdate
 *   canDelete(node) = node.ownerUserId === me || canDelete
 *   canCreate       = canCreate            (New-subfolder)
 * (there are NO per-node write grants — cohort/per-user grants only widen the SELECT
 * visibility fence, never the update/delete USING — so the space verb is the whole
 * non-owner capability). */
export type SpaceCapabilities = {
  canUpdate: boolean;
  canDelete: boolean;
  canCreate: boolean;
};

/** One cohort scope of the space + whether THIS node is fenced to it. Drives the
 * panel's "who can see it" section (cohort/scope visibility). */
export type ScopeChoice = {
  id: string;
  name: string;
  linked: boolean;
};

/** Broadcast floor (the `knowledge_resources.visibility` enum) — the single
 * per-resource dial: private (owner + supervisory) / space / organization
 * (ADR-0017 §1.5). Cohort grants compose additively on top. */
export type ResourceFloor = 'private' | 'space' | 'organization';
