import type { ProjectionResult } from '@workspace/knowledge-contracts';

import type {
  ContainmentEdge,
  KbAttributes,
  NodeMeta,
  ResourceTag,
  SharedByMeEntry,
  ShareMechanismByItem,
  ShortcutEdge,
  SpaceCapabilities,
  SpaceEntitlements,
} from '@/app/graph/graph-data.types';

/**
 * View-contract TYPES — extracted from the view registry so a single view can
 * import its prop type WITHOUT pulling the registry hub (which imports every view
 * component) into the bundle. A view imports only the types (tree-shake boundary).
 *
 * View components are PURELY presentational: their only inputs are the already-
 * resolved `ProjectionResult` (RLS already narrowed it), the i18n message catalog
 * (a plain serializable object — NOT the `t` function, which cannot cross the RSC
 * boundary), and the server-loaded KB seed. They never touch Supabase/the resolver.
 */

/**
 * Server-loaded KB seed the Drive view reads — all RLS-scoped fan-outs alongside
 * the resolved canvas: the containment forest (folder tree / counts via FORWARD
 * `contains`), the shortcut forest (Drive cross-folder symlinks), the KB satellite
 * attributes (link/media), node meta (owner/updated), the current user id
 * (owner "You" label), and the tag topology (per-item tags + the space tag
 * vocabulary). Fields for the not-yet-ported surfaces (derived
 * node health) are added when those are pulled under the front.
 */
export type KbViewData = {
  attributesByItem: Record<string, KbAttributes>;
  metaByItem: Record<string, NodeMeta>;
  /**
   * The tags OF each resolved item — `resource_id → tag nodes`
   * it points at via a FORWARD `tagged` edge. A presentation fan-out alongside the
   * canvas (`loadResourceTagsForItems`), NEVER a field on the frozen contract: a tag
   * is an ordinary node, "R is tagged T" a directed edge, so this is the read-side
   * projection of the incoming/outgoing `tagged` topology. Drives the Drive card tag
   * chips, the ResourcePanel tag section (the node's current tags), and the client-
   * side tag-facet filter (an item passes iff its tag set meets the active tags). A
   * node with no `tagged` edge has no key (absent → no tags, poc-no-fallbacks).
   */
  tagsByItem: Record<string, ResourceTag[]>;
  /**
   * ALL tag nodes of the space — the space's tag vocabulary,
   * loaded once (`loadSpaceTags`) under the user's RLS. Space-global by construction:
   * a tag is an ordinary node on the same row policy, and there is no separate tag-
   * visibility model, so every reader of the space sees the space's tags (the
   * confirmed model — no per-owner tag fence). Drives the ResourcePanel "pick from
   * existing tags" tray and the lens tag-facet chip row. Empty when the space has no
   * tags (or no active space).
   */
  spaceTags: ResourceTag[];
  containment: ContainmentEdge[];
  shortcuts: ShortcutEdge[];
  currentUserId: string | null;
  /**
   * The CURRENT user's space-level knowledge verbs (`update`/`delete`/`create`),
   * resolved ONCE server-side (constant across the space). The `⋯` node-actions menu
   * combines these with per-node ownership to DISPLAY-GATE its destructive/edit items —
   * a shared, non-owner viewer without the verbs sees only Copy + Details.
   * Fail-SAFE UX, never the security boundary (RLS is the sole authority).
   */
  capabilities: SpaceCapabilities;
  /**
   * The CURRENT space's COMMERCIAL entitlements — a plan-derived signal,
   * resolved ONCE server-side from the platform `runtime_settings` registry, NOT from
   * RLS verbs. Rides as a SIBLING of `capabilities` (NOT inside it): an entitlement is
   * a DIFFERENT authority (commercial plan vs RLS permission), kept ORTHOGONAL so the
   * verb namespace is never polluted with billing state (Fork 1). Today the only
   * dimension is `advancedStructuralView` — the gate for the advanced (structural /
   * containment-tree) display of the STRUCTURAL lenses (the two Shared lenses + Starred
   * + Trash). A DISPLAY gate, never a fence: the same RLS-visible
   * node-set renders either way (Fork 2). Defaults all-`false` (cheapest plan) on the
   * no-space / fail-closed branch.
   */
  entitlements: SpaceEntitlements;
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
  /**
   * The TRASH lens seed — the same machinery as the live canvas,
   * resolved server-side under the user's RLS with the `deleted_at IS NOT NULL`
   * selector. Trash is a THIRD axis (existence), orthogonal to access + workflow:
   * the same user sees a node in ONE lens and not the other, so the trashed/normal
   * split is a query lens, never an access fence (the RLS floor is unmoved). The
   * trashed set rides alongside the live `result` exactly as Starred/Recent are flat
   * lenses over the live canvas — so the client-side scope switch needs no server
   * re-navigation. Absent (no active space / never resolved) = an empty Trash lens.
   *
   * Edges AMONG trashed nodes are dormant (both-endpoints-trashed → hidden by the
   * fork #2 edge SELECT policy), so the trashed set renders FLAT (each trashed node
   * is its own "trashed root") — there is no containment tree inside Trash.
   */
  trash: TrashLensData;
  /**
   * The "Shared by me" lens seed — the resources the CURRENT user
   * has shared OUT, each with the people they granted it to. A read-only projection
   * over `knowledge_resource_user_grants WHERE granted_by = me` joined to the resources
   * I can still SEE (RLS the fence, fail-closed): a resource I revoked the only grant on
   * — or can no longer see — never appears. Rides alongside the live canvas exactly as
   * the flat 'shared' lens does; the view INTERSECTS these `resourceId`s with the
   * resolved canvas (lens = canvas ∩ {ids I granted}) and reads `grantees` for the
   * grantee summary. Empty when I've shared nothing visible. v1 = per-user grants only
   * (cohort-by-me is a DEFERRED additive layer).
   */
  sharedByMe: SharedByMeEntry[];
  /**
   * The "Shared with me" mechanism annotation — a map from each node
   * in the shared set (visible nodes I do NOT own — the same set the `'shared'` lens
   * filters to) to the WINNING mechanism that grants ME access: `personal` (a per-user
   * grant to me) > `cohort` (a cohort I'm in) > `broadcast` (the floor/supervisory
   * residual). Resolved server-side under the user's RLS by ONE batched fanout
   * (`annotateShareMechanism`) — pure DISPLAY ENRICHMENT of an already-visible set,
   * never a fence (a node not visible to me is never in the input, so it can never be
   * annotated). The render agent reads it to badge each shared card by mechanism and to
   * drive the facet chip row. Empty when nothing is shared-with-me.
   */
  shareMechanism: ShareMechanismByItem;
  /**
   * The EFFECTIVE per-org max-upload size in BYTES,
   * resolved server-side under the user's RLS (org → global → 200 MB default,
   * clamped to the 5 GB hard cap). Drives the CreateResource picker's client-side
   * "too large (max {size})" pre-validation — a UX hint ONLY; the server authorizer
   * (which re-resolves the same value) + the bucket `file_size_limit` are the fences.
   * Absent (no active space) → the view falls back to `DEFAULT_MAX_UPLOAD_BYTES`.
   */
  maxUploadBytes: number;
};

/**
 * The server-resolved Trash lens. The trashed node set + its owner meta,
 * resolved under the user's RLS with `deleted_at IS NOT NULL`. An ungranted/empty
 * Trash is `items=[]`, never an error.
 */
export type TrashLensData = {
  /** The trashed nodes (flat — dormant edges hide any tree among them). */
  items: { id: string; kind: string; title: string }[];
  /** Owner + last-modified for the trashed nodes (the "{kind} · {owner}" meta line). */
  metaByItem: Record<string, NodeMeta>;
};

/**
 * The active Drive sidebar filter, owned by the workbench and mirrored in the URL
 * (`?scope=`) so the lenses are shareable + survive refresh. 'kb' browses the
 * containment tree; 'home'/'starred'/'recent'/'shared'/'shared-by-me' are flat
 * cross-cutting lenses. 'shared' = visible nodes I do NOT own (owner ≠ me) — a loader
 * lens on top of the already-personal RLS floor, NOT a security boundary. 'shared-by-me'
 * = the resources I have shared OUT (owner-direction sibling of
 * 'shared'): the canvas ∩ the `kbData.sharedByMe` resourceId set, the read-only
 * projection over my per-user grants. 'home' = the personalized
 * "For you" digest (recently opened + recently updated) over the now-personal visible
 * set (personalization on the activity spine). 'search' = the lexical
 * search lens (slice-12 Phase 1) — NOT a projection over the resolved
 * canvas but a SUBSTRATE-capability surface that resolves its own `SearchResult` live
 * (debounced `?q=` term) under the same RLS transport; the first consumer of the
 * search capability, rendered in the Drive workbench but not bound to it.
 */
export type DriveScope =
  | 'kb'
  | 'home'
  | 'starred'
  | 'recent'
  | 'shared'
  | 'shared-by-me'
  | 'trash'
  | 'search';

/**
 * The lenses that get the advanced (structural / containment-tree) DISPLAY MODE —
 * a render-side OPT-IN set, the single source of truth for the
 * `lensView` gate. A lens here can toggle Flat↔Advanced (gated by the
 * `advancedStructuralView` entitlement); a lens NOT here (Recent, Home) NEVER shows the
 * toggle and is never structural:
 *  - `shared` / `shared-by-me` — the two Shared lenses (the original Fork 5 cases).
 *  - `starred` — the starred set ∩ canvas, over the LIVE containment forest.
 * 'kb' is omitted: it is already the structural browse, not a flat lens being upgraded.
 * 'recent' is omitted BY DECISION (a log / ordering, not a containment projection);
 * 'home' is a personal digest, likewise excluded.
 *
 * NOTE — `trash` is INTENTIONALLY NOT here yet. Its structural
 * tree needs the `contains` edges AMONG trashed nodes, but those edges are DORMANT: the
 * edge SELECT RLS requires BOTH endpoints `deleted_at IS NULL`, so a both-trashed edge
 * is not selectable under the user's RLS client at all (not merely filtered). Building
 * the Trash tree therefore needs a backend addition (a SECURITY DEFINER read of dormant
 * edges, or an edge-policy change) beyond a thin RLS select — surfaced for a decision
 * rather than silently shipping a flat-rooted (wrong) Trash "tree".
 */
export const STRUCTURAL_LENS_SCOPES: ReadonlySet<DriveScope> =
  new Set<DriveScope>(['shared', 'shared-by-me', 'starred']);

/**
 * The DISPLAY-MODE axis for the STRUCTURAL lenses —
 * ORTHOGONAL to `DriveScope` (it modulates HOW a lens renders, never WHICH scope is
 * active, so it adds NO new `DriveScope` member). It applies to the lenses in
 * `STRUCTURAL_LENS_SCOPES` (the two Shared lenses + Starred + Trash) — NEVER Recent or
 * Home (a log / personal digest, structurally excluded by decision). 'flat' = the digest
 * the lens ships with (the default, zero behavioural change); 'advanced' = the
 * KB-containment TREE over the same lens node-set (the same `buildContainment` render,
 * narrowed) — a projection-within-a-projection (the lens filter composed over the
 * structural view), gated by the `advancedStructuralView` entitlement. Owned by the
 * workbench in the URL (`?view=`) exactly as `?scope=`/`?folder=`/`?doc=` are, SSR-stable.
 * The server forces it to 'flat' when the space is not entitled, so a hand-edited
 * `?view=advanced` on a locked plan still renders flat (the gate is honest without being
 * a security boundary — the cheap plan always renders flat over the SAME RLS-visible set).
 */
export type LensView = 'flat' | 'advanced';

/**
 * The multi-select model (release-hardening B2) — the DISTINCT bulk-selection affordance
 * (checkboxes + the floating bulk bar), owned by the workbench and threaded to the view.
 * SEPARATE from the single-node Details selection (`selectedId`): a checkbox toggles
 * membership here and must NOT open Details. `toggleRange` selects the contiguous run
 * between the last-toggled anchor and `id` over the CURRENT ORDERED VISIBLE id list the
 * view supplies (its own visual order). Forced-clear on lens/folder change is the
 * workbench's job (a selection never leaks across lenses).
 */
export type DriveMultiSelect = {
  selectedIds: ReadonlySet<string>;
  count: number;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  toggleRange: (id: string, orderedVisibleIds: readonly string[]) => void;
  selectAll: (ids: readonly string[]) => void;
  clear: () => void;
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
   * Reveal a node in the KB containment tree — jump to the default 'kb' lens at the node's
   * PARENT folder so its position among siblings is visible. Wired by the workbench (which
   * owns navigation) to the card `⋯` menu's "Open in KB" item and the inline target button.
   */
  onRevealInKb?: (nodeId: string) => void;
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
  /**
   * The active lens DISPLAY MODE, owned by the workbench in the
   * URL (`?view=flat|advanced`) — the SERVER-resolved EFFECTIVE mode (already forced to
   * 'flat' when the space is not entitled), so the toolbar toggle + the canvas render
   * agree SSR-side with no hydration flip. Read by the view only for the STRUCTURAL
   * lenses (`STRUCTURAL_LENS_SCOPES` — Shared/Shared-by-me/Starred/Trash); ignored for
   * every other scope (never Recent/Home). Defaults 'flat'.
   */
  lensView?: LensView;
  /** Switch the lens display mode (Flat ↔ Advanced). The workbench writes it to the URL
   * (`?view=`). Only ever called from a structural lens's toolbar toggle. */
  onLensViewChange?: (view: LensView) => void;
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
  /** PASTE the clipboard source AS A SHORTCUT into a folder — a
   * `shortcut` edge folder→source instead of a deep copy. Folder-only (a shortcut
   * hangs off a folder), so the view offers it only inside a folder, never at root. */
  onPasteShortcut?: (targetFolderId: string) => void;
  /** CLEAR the clipboard (the ✕ on the Paste control / Escape). */
  onClearClipboard?: () => void;
  /** REMOVE a shortcut card — delete the `shortcut` edge folder→target.
   * Only the symlink is removed; the target node + its canonical home stay. Resolves
   * `true` on success; `delete`-verb gated in the DB (a disallowed remove is a no-op). */
  onRemoveShortcut?: (folderId: string, targetId: string) => Promise<boolean>;
  /**
   * RESTORE a trashed node (Trash lens) — `PATCH /author/graph/trash`. Clears
   * `deleted_at`; references re-admit automatically (dormant edges). Resolves to
   * `true` on success so the view can re-resolve. Owner-sovereign / `delete`-verb
   * gated in the DB — an unauthorized restore is a clean no-op (false), never a throw.
   */
  onRestore?: (nodeId: string) => Promise<boolean>;
  /**
   * PURGE a trashed node (Trash lens) — `DELETE /author/graph/trash`, the one-way
   * door. Returns the outcome so the view surfaces it: `purged` on success;
   * `in-use` when the in-use guard rejected it (living cross-owner references — the
   * purge needs `space.knowledge.delete`); `error` for any other clean rejection.
   * Never throws (graceful — the guard rejection is surfaced, not raised).
   */
  onPurge?: (nodeId: string) => Promise<'purged' | 'in-use' | 'error'>;
  /**
   * Multi-select model (B2) — drives the per-card / per-row checkboxes + the "select all
   * visible" header. The view computes the CURRENT ORDERED VISIBLE ids and passes them to
   * `toggleRange` (shift-click) / `selectAll`. Absent → no bulk selection (the checkboxes
   * do not render). The floating bulk bar itself is rendered by the workbench.
   */
  multiSelect?: DriveMultiSelect;
  /**
   * Empty Trash (B2) — the Trash-lens toolbar button asks the workbench to open its
   * mandatory purge-all confirm (the workbench owns the confirm + the batch fan-out).
   * Absent → no button (a lens that is not Trash, or no bulk affordance wired).
   */
  onEmptyTrash?: () => void;
};
