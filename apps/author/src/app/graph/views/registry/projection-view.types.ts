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
  /**
   * The ids of nodes the CURRENT user has starred in this space (per-user state,
   * own rows under RLS). Drives the Drive sidebar's "Starred" filter and the
   * filled/empty star toggle on each card. Empty when nothing is starred.
   */
  starredIds: string[];
  /**
   * The CURRENT user's "last opened by me" timestamps (`resource_id → ISO`), per-user
   * state under RLS. Drives the "Recent" filter (recently VIEWED by me) — its sort
   * and its "Viewed" column. A missing key = never opened by this user.
   */
  openedAtById: Record<string, string>;
};

/**
 * The active Drive sidebar filter, owned by the workbench and mirrored in the URL
 * (`?scope=`) so the lenses are shareable + survive refresh. 'kb' browses the
 * containment tree; 'home'/'starred'/'recent'/'shared' are flat cross-cutting lenses.
 * 'shared' = visible nodes I do NOT own (owner ≠ me) — a loader lens on top of the
 * already-personal RLS floor, NOT a security boundary (ADR-0017 §2.1). 'home' = the
 * personalized "For you" digest (recently opened + recently updated) over the
 * now-personal visible set (ADR-0017 §4, personalization on the activity spine).
 */
export type DriveScope = 'kb' | 'home' | 'starred' | 'recent' | 'shared';

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
  /**
   * The active filter scope, owned by the workbench in the URL (`?scope=`). When
   * provided the view is CONTROLLED (Starred/Recent are shareable + SSR-stable);
   * when omitted the view falls back to its own local scope (standalone / tests).
   */
  scope?: DriveScope;
  /** Switch the filter scope. The workbench writes it to the URL. */
  onScopeChange?: (scope: DriveScope) => void;
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
  /** Persisted grid/list layout, read SERVER-SIDE from the `drive-layout` cookie so
   * the SSR'd HTML already renders it (no post-hydration flip). Seeds the view's
   * layout state; the toggle writes the cookie back. */
  initialLayout?: 'grid' | 'list';
  /** Dual-pane is active (the workbench shows two independent panes). Drives the
   * toolbar toggle's pressed state. */
  split?: boolean;
  /** Toggle dual-pane on/off (a second, ephemeral navigation pane). Optional — a view
   * without the affordance omits it. */
  onToggleSplit?: () => void;
  /** Render WITHOUT the left sidebar — used for the split's second pane, which shares
   * the first pane's one sidebar (just its own toolbar + canvas). */
  hideSidebar?: boolean;
  /**
   * The Dolphin-style clipboard (owned by the workbench): a node MARKED for copy via
   * the `⋯` "Copy" action. When set AND this pane is in 'kb' browse scope, the view
   * shows a Paste affordance in its toolbar that pastes INTO this pane's current
   * folder. Null = nothing marked. Persists after a paste (multi-paste) until a new
   * Copy replaces it. */
  clipboard?: { sourceId: string; title: string } | null;
  /** MARK a node for copy (no write) — replaces the old immediate duplicate-in-place.
   * The `⋯` "Copy" calls this. */
  onCopyToClipboard?: (nodeId: string, title: string) => void;
  /** PASTE the clipboard source into a folder (null → top level). The VIEW builds the
   * "X (copy)" rootTitle (it has `t`); the workbench just POSTs the deep-copy. */
  onPaste?: (targetFolderId: string | null, rootTitle: string) => void;
  /** CLEAR the clipboard (the ✕ on the Paste control / Escape). */
  onClearClipboard?: () => void;
};
