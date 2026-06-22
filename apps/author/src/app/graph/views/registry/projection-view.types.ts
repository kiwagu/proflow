import type { ProjectionResult } from '@workspace/knowledge-contracts';

import type {
  ContainmentEdge,
  KbAttributes,
  NodeMeta,
  ShortcutEdge,
} from '@/app/graph/graph-data.types';

/**
 * View-contract TYPES — extracted from the view registry so a single view can
 * import its prop type WITHOUT pulling the registry hub (which imports every view
 * component) into the bundle. A view imports only the types (tree-shake boundary).
 *
 * View components are PURELY presentational: their only inputs are the already-
 * resolved `ProjectionResult` (RLS already narrowed it), the i18n message catalog
 * (a plain serializable object — NOT the `t` function, which cannot cross the RSC
 * boundary), and the server-loaded KB seed. They never touch Supabase/the resolver
 * (ADR-0005 §b).
 */

/**
 * Server-loaded KB seed the Drive view reads — all RLS-scoped fan-outs alongside
 * the resolved canvas: the containment forest (folder tree / counts via FORWARD
 * `contains`), the shortcut forest (Drive cross-folder symlinks), the KB satellite
 * attributes (link/media), node meta (owner/updated), and the current user id
 * (owner "You" label). Fields for the not-yet-ported views (tags, derived health,
 * the all-tags tray) are added when those views are pulled under the front.
 */
export type KbViewData = {
  attributesByItem: Record<string, KbAttributes>;
  metaByItem: Record<string, NodeMeta>;
  containment: ContainmentEdge[];
  shortcuts: ShortcutEdge[];
  currentUserId: string | null;
};

export type ProjectionViewProps = {
  result: ProjectionResult;
  /** Plain serializable message catalog (RSC-safe); the view builds its own `t`. */
  messages: Record<string, string>;
  /**
   * The currently selected node id (shared across views — open node survives a
   * switch). The view highlights it; the workbench owns it.
   */
  selectedId?: string;
  /** Select a node → opens the SHARED ResourcePanel (owned by the workbench). */
  onSelect: (nodeId: string) => void;
  /**
   * Open a `kind=text` node as a document → the SHARED read-view (owned by the
   * workbench). Distinct from `onSelect` (the Details panel): clicking a document
   * reads it, the ⋯ menu's Details still opens the panel. Optional — a view that
   * has no document-open affordance simply omits it and falls back to `onSelect`.
   */
  onOpenDocument?: (nodeId: string) => void;
  /**
   * Edit a `kind=text` node directly (skip the reader) — the workbench's edit
   * launcher runs the seed-choice flow and navigates to the editor. The card `⋯`
   * menu wires this for text nodes. Optional — omitted where there is no editor.
   */
  onEditNode?: (nodeId: string) => void;
  /**
   * The current folder location (a `kind=folder` node id, or null for the root),
   * owned by the workbench in the URL so it survives refresh / browser history.
   * Drive-navigation props — views without a folder tree simply omit them and
   * keep their own local location.
   */
  folderId?: string | null;
  /** Navigate to a folder (null → root). The workbench writes it to the URL. */
  onNavigate?: (folderId: string | null) => void;
  /** Bumped by the workbench after a mutation so views drop stale lazy children. */
  refreshKey: number;
  /** Re-run the server resolve after a mutation (the workbench refreshes). */
  onMutated: () => void;
  /**
   * Active space id — the view's write target (authoring POSTs carry
   * `{ spaceId, … }`). The result contract intentionally does not echo
   * `space_id`, so the page threads it here.
   */
  spaceId?: string;
  /** Server-loaded KB seed (RLS-scoped fan-outs alongside the resolved canvas). */
  kbData?: KbViewData;
};
