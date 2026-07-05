'use client';

import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Button } from '@workspace/ui/components/button';
import { Checkbox } from '@workspace/ui/components/checkbox';
import { EmptyState } from '@workspace/ui/components/empty-state';
import { Hint } from '@workspace/ui/components/hint';
import { ToggleChip } from '@workspace/ui/components/toggle-chip';
import { WorkbenchShell } from '@workspace/ui/components/workbench-shell';
import { byText } from '@workspace/ui/lib/sort';
import { cn } from '@workspace/ui/lib/utils';
import {
  Check,
  ChevronRight,
  Clipboard,
  ClipboardPaste,
  Clock,
  Columns2,
  FileUp,
  FolderSymlink,
  House,
  Send,
  Star,
  Tag as TagIcon,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import * as React from 'react';

import type { ResourceStatus } from '@workspace/knowledge-contracts';

import type {
  ResourceTag,
  ShareMechanism,
  SharedByMeEntry,
} from '@/app/graph/graph-data.types';
import { STRUCTURAL_LENS_SCOPES } from '@/app/graph/views/registry/projection-view.types';
import type {
  DriveScope,
  LensView,
  ProjectionViewProps,
} from '@/app/graph/views/registry/projection-view.types';
import {
  buildContainment,
  childContent,
  childFolders,
  pathTo,
  rootContent,
  rootFolders,
  sharedOut,
  type LensNode,
} from '@/app/graph/containment';
import {
  CreateResource,
  type CreateRequest,
} from '@/app/graph/create-resource.view';
import { iconForKind } from '@/app/graph/presentation';
import { DriveSidebar } from '@/app/graph/views/drive/drive-sidebar';
import { LayoutToggle } from '@/app/graph/views/drive/layout-toggle';
import type { DriveLayout } from '@/app/graph/views/drive/layout-toggle';
import { LensTreeGrid } from '@/app/graph/views/drive/lens-tree-grid';
import type { LensTreeNode } from '@/app/graph/views/drive/lens-tree-grid';
import { LensViewToggle } from '@/app/graph/views/drive/lens-view-toggle';
import { NodeActionsMenu } from '@/app/graph/node-actions-menu';
import {
  CanvasRootDropZone,
  CARD_ACTION_TRIGGER,
  DraggableDroppableFolderCard,
  DraggableItemCard,
  FolderCard,
  GRID_WRAP,
  ItemCard,
  LIST_WRAP,
  RemoveShortcutButton,
  RevealInKbButton,
  RootDropZone,
  SectionLabel,
  SelectCheckbox,
  StarButton,
  TrashCard,
} from '@/app/graph/views/drive/cards';
import {
  GranteeSummary,
  SHARE_MECHANISM_ORDER,
  SharedFolderHint,
  ShareFacetChips,
  ShareMechanismBadge,
  StatusFacetChips,
} from '@/app/graph/views/drive/badges';
import {
  artifactBytes,
  buildFolderHasArtifactIndex,
  buildFolderSizeIndex,
  isUploadedArtifact,
  makePruneKeep,
} from '@/app/graph/views/drive/uploaded-artifacts';
import { LensListTable } from '@/app/graph/views/drive/list';
import type { DriveRow } from '@/app/graph/views/drive/list';
import { formatWhen } from '@/app/graph/views/drive/drive-projection.format';
import { useAccessBadge } from '@/app/graph/views/drive/use-access-badge';
import { LensToolbar } from '@/app/graph/views/lens-toolbar';

/**
 * DriveProjectionView — the prototype `DriveView`, pixel-1:1 (slice-11 Ф3 §2,
 * ADR-0014 `view='drive'`). The "Google Drive" projection over the SAME graph:
 * folders are container nodes (`kind='folder'`), reached by walking the FORWARD
 * `contains` forest (ADR-0015); a folder may hold `shortcut` cross-links to other
 * folders/targets (Drive-only symlinks, EXCLUDED from containment traversal). A
 * familiar 230px sidebar (New + nav + sections) + breadcrumb + grid/list toggle +
 * folder/shortcut/file cards — the graph stays invisible behind the tree.
 *
 * PURELY presentational (ADR-0005 §b): it consumes the resolved canvas + the
 * server-loaded `contains`/`shortcut` forests (`kbData`); it never queries Supabase
 * or the resolver. Selecting a content node opens the SHARED ResourcePanel (owned
 * by the workbench, via `onSelect`); navigating into a folder is local view state.
 * Authoring (New / Upload / New folder) routes through the landed `CreateResource`
 * modal → RLS write routes. RLS is the sole authority — an ungranted user resolves
 * to an empty Drive and cannot author.
 *
 * Sizes/spacing/typography match the prototype exactly (230px rail, 12px nav pad,
 * 220px grid min, etc.); color is always a token so dark mode works.
 */

export function DriveProjectionView({
  result,
  messages,
  selectedId,
  onSelect,
  onOpenDocument,
  onEditNode,
  onRevealInKb,
  folderId = null,
  onNavigate,
  scope: scopeProp,
  onScopeChange,
  lensView: lensViewProp,
  onLensViewChange,
  initialLayout,
  onMutated,
  refreshKey,
  spaceId,
  kbData,
  split = false,
  onToggleSplit,
  hideSidebar = false,
  clipboard,
  onCopyToClipboard,
  onPaste,
  onPasteShortcut,
  onClearClipboard,
  onRestore,
  onPurge,
  onRemoveShortcut,
  multiSelect,
  onEmptyTrash,
}: ProjectionViewProps) {
  const t = React.useMemo(() => createGraphTranslator(messages), [messages]);

  // Locale/timezone date strings (`formatWhen`) differ between the server and the browser, so
  // the "For you" sort dates render CLIENT-ONLY: `useSyncExternalStore` reports `false` on the
  // server snapshot and `true` on the client — SSR + first hydration emit no date (no mismatch),
  // then it appears.
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  // Stable references for the empty fallbacks so the `containment`/`shortcuts`
  // memos below don't recompute every render (a fresh `[]` would invalidate them).
  const containmentEdges = React.useMemo(
    () => kbData?.containment ?? [],
    [kbData]
  );
  const shortcutEdges = React.useMemo(() => kbData?.shortcuts ?? [], [kbData]);
  // Memoized so the `?? {}` default is a STABLE reference — `attributesByItem` now feeds
  // the `isArtifact`/`bytesOf` `useCallback`s (the uploaded-artifact filter + size index);
  // a fresh `{}` each render would thrash those hooks (react-hooks/exhaustive-deps).
  const attributesByItem = React.useMemo(
    () => kbData?.attributesByItem ?? {},
    [kbData]
  );
  // Memoized so the `?? {}` default is a STABLE reference — `metaByItem` feeds
  // `floorOf` (the broadcast badge) which is a `useCallback`/`useMemo` dependency;
  // a fresh `{}` each render would thrash those hooks (react-hooks/exhaustive-deps).
  const metaByItem = React.useMemo(() => kbData?.metaByItem ?? {}, [kbData]);
  // Per-item tags (ADR-0003 Variant B) — `resource_id → tag nodes` it points at via a
  // FORWARD `tagged` edge. Memoized for a STABLE `?? {}` default (it feeds the tag-facet
  // predicate + the resolved-set vocabulary, both `useMemo`/`useCallback` deps). Drives
  // the card tag chips, and the client-side tag-facet filter below.
  const tagsByItem = React.useMemo(() => kbData?.tagsByItem ?? {}, [kbData]);
  // The "Shared with me" mechanism annotation (ADR-0021 Part C): each node in the
  // 'shared' set → the WINNING mechanism that grants ME access (personal > cohort >
  // broadcast, precedence applied server-side). Pure DISPLAY enrichment of an
  // already-RLS-admitted set — drives the per-card badge + the facet chip row, never a
  // fence. Empty when nothing is shared-with-me.
  const shareMechanism = kbData?.shareMechanism ?? {};
  const currentUserId = kbData?.currentUserId ?? null;
  // The viewer's space verbs — combined with each node's owner (from `metaByItem`)
  // to display-gate its `⋯` menu. Fail-CLOSED default (all false) when no seed: the
  // standalone/empty case shows only the always-on Copy + Details.
  const capabilities = kbData?.capabilities ?? {
    canUpdate: false,
    canDelete: false,
    canCreate: false,
    canAccess: false,
  };
  // Per-user "last opened by me" overlay (`resource_id → ISO`); drives the Recent
  // filter (recently VIEWED by me) and its "Viewed" column. Absent key = unopened.
  const openedAtById = kbData?.openedAtById ?? {};

  // Which sidebar filter is active. 'kb' browses the containment tree (the default
  // Drive); 'starred' and 'recent' are flat cross-cutting lenses over the same
  // RLS-resolved canvas — not folders. Opening any folder returns to 'kb'.
  //
  // CONTROLLED when the workbench passes `scope`/`onScopeChange` — it owns the scope
  // in the URL (`?scope=`), so Starred/Recent are shareable + SSR-stable. UNCONTROLLED
  // fallback to local state when omitted (standalone render / tests).
  const controlled = onScopeChange != null;
  const [localScope, setLocalScope] = React.useState<DriveScope>('kb');
  const scope = scopeProp ?? localScope;
  const applyScope = React.useCallback(
    (next: DriveScope) => {
      if (controlled) {
        onScopeChange(next);
      } else {
        setLocalScope(next);
      }
    },
    [controlled, onScopeChange]
  );
  const isStarred = scope === 'starred';
  const isRecent = scope === 'recent';
  const isShared = scope === 'shared';
  // "Open in KB" is pointless in the KB lens itself (a CANONICAL card is already at its
  // position) — so the card target button + ⋯ item are suppressed there. Every other lens
  // (flat or an advanced tree of a DIFFERENT set) loses the containment context, so it is
  // offered. (Shortcut cards, which point elsewhere, keep their own affordance.)
  const onRevealInKbAction = scope === 'kb' ? undefined : onRevealInKb;
  // The "Shared with me" facet (ADR-0021 Part C): a client-side filter over the
  // mechanism annotation — `null` = All. Local to the lens (a UI filter, never a
  // fence). State is stored raw, but every READER goes through `shareFacet`, which is
  // forced to `null` (All) outside the 'shared' lens — so the facet always resets when
  // you leave and re-enter the lens, with no setState-in-effect cascade.
  const [shareFacetState, setShareFacet] =
    React.useState<ShareMechanism | null>(null);
  const shareFacet = isShared ? shareFacetState : null;
  // The cross-lens "Only files" filter (ADR-0026 render): ONE toggle over EVERY content
  // lens (KB browse, the flat filter lenses, the advanced structural trees) — NEVER Trash
  // (a holding state, not a content lens). State is raw but every READER goes through
  // `uploadedOnly` (derived below, forced OFF in Trash) so the toggle resets on entering
  // Trash with no setState-in-effect.
  const [uploadedOnlyState, setUploadedOnly] = React.useState(false);
  // The tag facet (ADR-0003 Variant B) — a set of toggled tag ids. When non-empty the
  // canvas narrows to content carrying ANY active tag (union). A client-side filter over
  // `tagsByItem` (the read-side projection of the incoming `tagged` topology — the same
  // shape the engine's tagged-traversal computes, over the already-RLS-resolved set,
  // gap-doc :28), never a fence. Raw state; every reader goes through `tagFacetActive`
  // (forced off in Trash — a holding state, not a content lens) so it can't filter there.
  const [tagFacet, setTagFacet] = React.useState<ReadonlySet<string>>(
    () => new Set()
  );
  // The status facet (workflow lifecycle, B1) — a single selected status or null (All).
  // A client-side CONTENT filter over `LensNode.status`, the exact sibling of "Only
  // files": it narrows to leaves in one lifecycle state, pruning the browse tree to
  // branches with a matching leaf. Raw state; the reader `statusFacet` forces null in
  // Trash (a holding state, not a content lens) so it resets there with no effect.
  const [statusFacetState, setStatusFacet] =
    React.useState<ResourceStatus | null>(null);
  // The "Shared by me" lens (ADR-0021 Part B): the owner-direction sibling of
  // 'shared'. A flat lens = the resolved canvas ∩ the resourceIds I have granted OUT
  // (`kbData.sharedByMe`, SSR-seeded under my RLS). Each entry carries the grantee
  // list so the cards can show who I shared it with.
  const isSharedByMe = scope === 'shared-by-me';
  const isHome = scope === 'home';
  // The Trash lens (ADR-0018 fork #4): the trashed set (`deleted_at IS NOT NULL`),
  // resolved server-side under the user's RLS and threaded in `kbData.trash`. It is a
  // flat lens — edges among trashed nodes are dormant (both-endpoints-trashed → hidden
  // by the edge SELECT policy), so every trashed node is its own "trashed root". No
  // tree, no shortcuts, no breadcrumb, no DnD, no create/upload — only Restore + Purge.
  const isTrash = scope === 'trash';
  // When ON: flat mode filters the item set to uploaded artifacts; advanced mode prunes
  // the containment tree to branches that hold ≥1 artifact. OFF in Trash (see above).
  const uploadedOnly = isTrash ? false : uploadedOnlyState;
  // The STRUCTURAL lenses (ADR-0022 Addendum A) — the lenses that can render their
  // node-set as a containment TREE (the two Shared lenses + Starred). The toggle shows
  // ONLY here (never Recent/Home). Single source of truth: `STRUCTURAL_LENS_SCOPES`.
  const isStructuralLens = STRUCTURAL_LENS_SCOPES.has(scope);
  // The COMMERCIAL entitlement (ADR-0022 Fork 1) — a plan-derived signal, resolved
  // server-side from a DIFFERENT authority than the RLS verbs (`capabilities`). Fail-
  // CLOSED default `false` (cheapest plan / no seed). ONE generic unit across all
  // structural lenses (lens-agnostic).
  const advancedStructuralEntitled =
    kbData?.entitlements?.advancedStructuralView ?? false;
  // The lens DISPLAY MODE (ADR-0022 Fork 5 + Addendum A) — the workbench's server-clamped
  // `?view=`; CONTROLLED when threaded (`lensViewProp`), else 'flat' (standalone).
  const lensView: LensView = lensViewProp ?? 'flat';
  // The advanced (TREE) render is ON only when: a STRUCTURAL lens is active, the mode is
  // 'advanced', AND the space is entitled. Otherwise the lens stays a flat digest (the
  // default, and the forced render on a locked plan). This is the ONLY thing the
  // entitlement changes — the SAME RLS-visible node-set renders either way (Fork 2).
  const isLensAdvanced =
    isStructuralLens && lensView === 'advanced' && advancedStructuralEntitled;
  // A flat lens (Home / Recent / Trash / any structural lens in FLAT mode) hides the
  // folder tree, breadcrumb path, and shortcuts — the canvas is a flat digest/list, not
  // a folder you sit in. A structural lens in ADVANCED mode is EXCLUDED here (it renders
  // the containment tree over its node-set instead, Fork 3/5 + Addendum A).
  const isFilterScope =
    (isStructuralLens && !isLensAdvanced) || isRecent || isHome || isTrash;
  const starredSet = React.useMemo(
    () => new Set(kbData?.starredIds ?? []),
    [kbData]
  );
  // `resourceId → grantees` for the "Shared by me" lens: the membership test for the
  // lens (canvas ∩ keys) AND the per-card grantee summary in one map. Grantees arrive
  // pre-sorted by display name from the data layer (don't re-sort).
  const sharedByMeByResource = React.useMemo(() => {
    const map = new Map<string, SharedByMeEntry['grantees']>();
    for (const entry of kbData?.sharedByMe ?? []) {
      map.set(entry.resourceId, entry.grantees);
    }
    return map;
  }, [kbData]);

  const containment = React.useMemo(
    () => buildContainment(result.items, containmentEdges),
    [result.items, containmentEdges]
  );

  // The tag facet is live only outside Trash and only once a tag is toggled.
  const tagFacetActive = !isTrash && tagFacet.size > 0;
  // An item passes the tag facet iff it carries ANY active tag (union). Trivially true
  // when the facet is inactive, so it composes as a no-op `.filter` on any list.
  const hasActiveTag = React.useCallback(
    (id: string) => {
      if (!tagFacetActive) {
        return true;
      }
      const tags = tagsByItem[id];
      if (!tags) {
        return false;
      }
      return tags.some((tag) => tagFacet.has(tag.id));
    },
    [tagFacetActive, tagFacet, tagsByItem]
  );
  // The facet chip vocabulary = the tags PRESENT on the resolved (RLS-narrowed) canvas
  // (gap-doc :28), de-duped + sorted by title. A tag with no visible tagged node never
  // shows a chip (nothing to filter to). Toggling a tag never in the set is impossible.
  const resolvedTags = React.useMemo(() => {
    const byId = new Map<string, ResourceTag>();
    for (const item of result.items) {
      for (const tag of tagsByItem[item.id] ?? []) {
        byId.set(tag.id, tag);
      }
    }
    return [...byId.values()].sort(byText((tag) => tag.title));
  }, [result.items, tagsByItem]);
  // Toggle one tag id in/out of the facet set (a new Set each change → stable identity
  // churn only on real toggles).
  const toggleTagFacet = React.useCallback((tagId: string) => {
    setTagFacet((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) {
        next.delete(tagId);
      } else {
        next.add(tagId);
      }
      return next;
    });
  }, []);
  const clearTagFacet = React.useCallback(() => setTagFacet(new Set()), []);

  // The status facet is live only outside Trash and only once a state is picked.
  const statusFacet = isTrash ? null : statusFacetState;
  // A node passes the status facet iff it is CONTENT (folders/tags carry no lifecycle)
  // in the selected state. Trivially true when the facet is off, so it composes as a
  // no-op leaf term alongside "Only files" + the tag facet.
  const statusPass = React.useCallback(
    (node: LensNode) =>
      statusFacet == null ||
      (node.kind !== 'folder' &&
        node.kind !== 'tag' &&
        node.status === statusFacet),
    [statusFacet]
  );
  // The facet chip vocabulary = the DISTINCT content statuses present on the resolved
  // canvas. Shown only when ≥2 exist (a single-status canvas has nothing to filter) —
  // mirrors ShareFacetChips' ">1 mechanism" guard.
  const presentStatuses = React.useMemo(() => {
    const set = new Set<string>();
    for (const item of result.items) {
      if (item.kind !== 'folder' && item.kind !== 'tag') {
        set.add(item.status);
      }
    }
    return set;
  }, [result.items]);

  // The access-mirror predicate family (ADR-0023 §7) — `isGranted` (direct per-user
  // grant), the globe-XOR-people-XOR-lock `renderAccessBadge`, and the underlying
  // `accessStatus`. ONE source for BOTH the grid card and the list row, so they can
  // never diverge. Pure display over the RLS-seeded `sharedByMe` / node meta / forest.
  const { isGranted, renderAccessBadge } = useAccessBadge({
    t,
    containment,
    metaByItem,
    sharedByMeByResource,
  });

  // The lens node-set ids (ADR-0022 Fork 3 + Addendum A) for the ACTIVE structural lens
  // — the SAME set the flat lens computes (the advanced tree shows EXACTLY the flat
  // lens's nodes, only arranged structurally). `'shared'` = visible nodes I do NOT own;
  // `'shared-by-me'` = the canvas ∩ the ids I have granted OUT; `'starred'` = the canvas
  // ∩ my starred ids. Empty for any non-structural scope. Computed from the resolved
  // canvas + the already-loaded overlays — no new data, no new load (Invariant #1).
  const lensSetIds = React.useMemo(() => {
    if (isShared) {
      return new Set(
        result.items
          .filter((item) => {
            const owner = metaByItem[item.id]?.ownerUserId;
            return owner != null && owner !== currentUserId;
          })
          .map((item) => item.id)
      );
    }
    if (isSharedByMe) {
      return new Set(
        result.items
          .filter((item) => sharedByMeByResource.has(item.id))
          .map((item) => item.id)
      );
    }
    if (isStarred) {
      const starred = new Set(kbData?.starredIds ?? []);
      return new Set(
        result.items
          .filter((item) => starred.has(item.id))
          .map((item) => item.id)
      );
    }
    return new Set<string>();
  }, [
    isShared,
    isSharedByMe,
    isStarred,
    result.items,
    metaByItem,
    currentUserId,
    sharedByMeByResource,
    kbData,
  ]);

  // The advanced lens TREE's containment (ADR-0022 Fork 3 + Addendum A) — the EXISTING
  // `buildContainment` fed the lens SUBSET of the resolved items + the already-loaded
  // LIVE `contains` forest. No new data model, no resolver change, no new load
  // (Invariant #1). The forest builder drops any `contains` edge whose endpoint is NOT
  // in the subset, so a node whose containing folder is NOT in the lens set has no
  // parent → it appears at the ROOT of the lens tree — NO synthetic invisible ancestors
  // (graceful-absence, ADR-0018 §14). Built only when the advanced lens view is active.
  const lensContainment = React.useMemo(
    () =>
      buildContainment(
        result.items.filter((item) => lensSetIds.has(item.id)),
        containmentEdges
      ),
    [result.items, lensSetIds, containmentEdges]
  );

  // The containment the TREE traversal walks: the lens subset's forest in the advanced
  // lens view, else the full graph's forest (kb browse). Display-only — the ⋯ menu /
  // Move picker / ResourcePanel keep the FULL `containment` (their targets are the whole
  // graph, never the lens sub-tree).
  const treeContainment = isLensAdvanced ? lensContainment : containment;

  // The uploaded-artifact machinery (ADR-0026 render) — ONE predicate + two memoized,
  // single-pass indexes shared by the filter, the tree prune, and the size column, so
  // "an uploaded artifact" and "a folder's size" can never mean two different things
  // across lenses (lens-feature-component-reuse). Pure over the loaded attributes +
  // forest — never a query, never access logic.
  //
  // The size index sums over the FULL `containment` (the whole RLS-visible slice) so a
  // folder's size is stable across lenses; the prune's has-artifact index is over
  // `treeContainment` (the tree actually being walked — the lens subset when advanced).
  const isArtifact = React.useCallback(
    (node: LensNode) => isUploadedArtifact(node, attributesByItem[node.id]),
    [attributesByItem]
  );
  const bytesOf = React.useCallback(
    (node: LensNode) => artifactBytes(node, attributesByItem[node.id]),
    [attributesByItem]
  );
  const folderSizeIndex = React.useMemo(
    () => buildFolderSizeIndex(containment, bytesOf),
    [containment, bytesOf]
  );
  // The UNIFIED leaf predicate for the two cross-lens content filters — "Only files"
  // (ADR-0026: uploaded artifacts) AND the tag facet (ADR-0003: carries an active tag).
  // A leaf is KEPT iff it passes BOTH active filters (each a no-op when off), so the two
  // compose: a lens can be filtered to tagged files. Feeding it to the SAME prune index +
  // `pruneKeep` the "Only files" toggle already used means the tag facet prunes the browse
  // TREE to branches with a matching leaf (and filters the flat lists) with zero new
  // structure (lens-feature-component-reuse) — identical behaviour to "Only files".
  const leafPass = React.useCallback(
    (node: LensNode) =>
      (!uploadedOnly || isArtifact(node)) &&
      hasActiveTag(node.id) &&
      statusPass(node),
    [uploadedOnly, isArtifact, hasActiveTag, statusPass]
  );
  // At least one content filter is on → the tree prunes / the flat lists narrow.
  const anyLeafFilter = uploadedOnly || tagFacetActive || statusFacet != null;
  const folderHasKeptLeafIndex = React.useMemo(
    () => buildFolderHasArtifactIndex(treeContainment, leafPass),
    [treeContainment, leafPass]
  );
  const pruneKeep = React.useMemo(
    () => makePruneKeep(folderHasKeptLeafIndex, leafPass),
    [folderHasKeptLeafIndex, leafPass]
  );
  // The size for ONE row's node: a folder → its recursive visible-descendant sum (absent
  // from the index → null → "—"); a leaf → its own artifact bytes (null for text/link/
  // tag). Fed to the list table's size column.
  const sizeOf = React.useCallback(
    (node: LensNode): number | null =>
      node.kind === 'folder'
        ? (folderSizeIndex.get(node.id) ?? null)
        : bytesOf(node),
    [folderSizeIndex, bytesOf]
  );

  // Shortcuts grouped by source folder (Drive-only symlinks, not containment).
  const shortcutsByFolder = React.useMemo(() => {
    const map = new Map<string, LensNode[]>();
    const ordered = [...shortcutEdges].sort((a, b) => a.position - b.position);
    for (const edge of ordered) {
      const target = containment.byId.get(edge.to);
      if (!target) {
        continue; // RLS-hidden target → drop the symlink card.
      }
      const list = map.get(edge.from);
      if (list) {
        list.push(target);
      } else {
        map.set(edge.from, [target]);
      }
    }
    return map;
  }, [shortcutEdges, containment]);

  // Folder location is CONTROLLED by the workbench via the URL (`?folder=`), so
  // it survives refresh and browser history. `navigate(null)` returns to root.
  // Navigating into the tree always drops back to the 'kb' (browse) scope — the
  // 'starred' filter is a flat lens, never a folder you can sit inside. When the
  // workbench owns the scope it resets it inside `onNavigate`; the local fallback
  // resets here.
  const navigate = React.useCallback(
    (id: string | null) => {
      if (!controlled) {
        setLocalScope('kb');
      }
      onNavigate?.(id);
    },
    [controlled, onNavigate]
  );
  // Grid/list is seeded from the SERVER-read `drive-layout` cookie (so SSR already
  // renders the chosen layout — no post-hydration flip), and the toggle writes it
  // back. A per-device UI preference: a cookie, not localStorage (SSR-consistent,
  // no flash) and not the user profile (no cross-device need).
  const [layout, setLayout] = React.useState<DriveLayout>(
    initialLayout ?? 'grid'
  );
  const applyLayout = React.useCallback((next: DriveLayout) => {
    setLayout(next);
    if (typeof document !== 'undefined') {
      document.cookie = `drive-layout=${next};path=/;max-age=31536000;samesite=lax`;
    }
  }, []);
  const [createRequest, setCreateRequest] =
    React.useState<CreateRequest | null>(null);

  // Toggle this node's per-user starred flag — an UPSERT of the user's own
  // `resource_user_state` row under RLS (sole write authority), then re-resolve so
  // the star + the "Starred" filter reflect the new state. No optimistic flip: the
  // server round-trip is the source of truth (poc-no-fallbacks).
  const toggleStar = React.useCallback(
    (nodeId: string, next: boolean) => {
      if (!spaceId) {
        return;
      }
      void fetch('/author/graph/starred', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceId, nodeId, starred: next }),
      }).then((res) => {
        if (res.ok) {
          onMutated();
        }
      });
    },
    [spaceId, onMutated]
  );

  // A mutation may have removed the current folder — fall back to root. Clear the
  // stale folder DIRECTLY (not via `navigate`, which also resets `scope`): a setState
  // inside this effect would be a needless cascading render, and the scope is
  // unaffected by a vanished folder.
  React.useEffect(() => {
    if (folderId && !containment.byId.has(folderId)) {
      onNavigate?.(null);
    }
  }, [folderId, containment, refreshKey, onNavigate]);

  // Default ordering is by NAME (human-friendly: case-insensitive, natural) — for
  // BOTH grid and list — instead of the raw containment `position`. `.slice()`
  // before sorting so we never mutate the cached containment/shortcut arrays.
  const byTitle = byText((node: LensNode) => node.title);
  // Recent ordering: most-recently VIEWED BY ME first — the per-user
  // `last_opened_at` overlay (ADR-0016), NOT `updated_at`/activity. An item is in
  // Recent BECAUSE I opened it, so its open time is always defined and is the honest
  // timestamp (true whether or not it was edited). ISO strings compare
  // lexicographically = chronologically.
  const byRecency = (a: LensNode, b: LensNode) =>
    (openedAtById[b.id] ?? '').localeCompare(openedAtById[a.id] ?? '');
  // An advanced structural lens TREE (ADR-0022 + Addendum A) is folder-NAVIGABLE within
  // its lens: drilling a folder stays on the lens (`?scope=<lens>&folder=…&view=advanced`)
  // and NARROWS the canvas to that folder's subtree WITHIN the lens subset — it never
  // leaves the lens for kb-browse, and never widens beyond the lens node-set (the tree
  // walks `treeContainment`, the lens subset's forest). A `folderId` that is NOT in the
  // lens subset (e.g. a stale kb-browse location) resolves to null → the lens root, so
  // the drill can only ever land on a lens folder. The roots/folder below therefore walk
  // `treeContainment` (the lens subset's forest when advanced, else the full graph). Flat
  // lenses ignore `folderId` (they are not folder locations).
  const roots = rootFolders(treeContainment);
  const drilledFolder =
    folderId != null ? (treeContainment.byId.get(folderId) ?? null) : null;
  const isRoot = isLensAdvanced ? drilledFolder == null : folderId == null;
  const folder = isLensAdvanced
    ? drilledFolder
    : isRoot
      ? null
      : (treeContainment.byId.get(folderId as string) ?? null);

  // The starred set as resolved nodes — `starredIds` mapped through the canvas,
  // dropping ids RLS hid or that no longer resolve. Folders and content split the
  // same way the tree view does, so the Starred canvas reuses every card/row path.
  const starredNodes = isStarred
    ? (kbData?.starredIds ?? [])
        .map((id) => containment.byId.get(id))
        .filter((node): node is LensNode => node != null)
    : [];

  // Recent = the content nodes I have OPENED (a `last_opened_at` overlay entry),
  // folders excluded, most-recently-viewed first. Resolved through the canvas so
  // RLS-hidden ids drop out. Per-user, not space-wide: a fresh user sees an empty
  // Recent until they open something (the open-record write feeds this overlay).
  const recentNodes = isRecent
    ? result.items
        .map((item) => containment.byId.get(item.id))
        .filter(
          (node): node is LensNode =>
            node != null &&
            node.kind !== 'folder' &&
            openedAtById[node.id] != null
        )
    : [];

  // Shared with me = the visible nodes I do NOT own (owner ≠ me), folders + content.
  // A loader lens over the already-RLS-narrowed canvas (ADR-0017 §2.1) — the owner
  // filter is a DISPLAY path, not a fence (the RLS floor is the authority). At Step 1
  // the floor is still 'space', so this surfaces "space-published by someone else".
  // The full shared-with-me set (owner ≠ me), BEFORE the facet filter — used to derive
  // which mechanism chips to show (only mechanisms actually present in the set).
  const sharedAllNodes = isShared
    ? result.items
        .map((item) => containment.byId.get(item.id))
        .filter((node): node is LensNode => {
          if (node == null) return false;
          const owner = metaByItem[node.id]?.ownerUserId;
          return owner != null && owner !== currentUserId;
        })
    : [];
  // The mechanisms present in the current shared set (de-duped, in precedence order) —
  // drives the facet chip row: a chip is shown only when at least one shared node uses
  // that mechanism (no empty "cohort" chip when nothing is cohort-shared).
  const presentMechanisms = SHARE_MECHANISM_ORDER.filter((mech) =>
    sharedAllNodes.some((node) => shareMechanism[node.id] === mech)
  );
  // The facet view of the shared set: All (`shareFacet === null`) shows everything;
  // a selected mechanism narrows to nodes whose WINNING mechanism matches. A pure
  // client display filter over the precomputed annotation — never recomputes access.
  const sharedNodes =
    isShared && shareFacet != null
      ? sharedAllNodes.filter((node) => shareMechanism[node.id] === shareFacet)
      : sharedAllNodes;

  // Shared by me = the resolved canvas ∩ the resourceIds I have granted OUT
  // (ADR-0021 Part B). The data layer already fail-closed it (a resource I can no
  // longer see, or whose only grant I revoked, is absent from `sharedByMe`); a
  // granted id that somehow isn't on the canvas simply doesn't resolve and drops out.
  // Folders + content split exactly like the 'shared' lens, reusing every card path.
  const sharedByMeNodes = isSharedByMe
    ? result.items
        .map((item) => containment.byId.get(item.id))
        .filter(
          (node): node is LensNode =>
            node != null && sharedByMeByResource.has(node.id)
        )
    : [];

  // "For you" home (ADR-0017 §4): a personal DIGEST over the now-personal visible set,
  // not a flat filter. Two sections, content only (folders excluded): what I recently
  // OPENED ("jump back in", `last_opened_at`) and what recently CHANGED that I can see
  // ("recently updated", `last_modified_at`). Both client-side over already-loaded
  // overlays — zero new data/migrations.
  // Cap each section: this is a relevance digest, not an archive — beyond ~50 the
  // entries are stale enough to have lost their "for you" value (and the list would
  // grow unbounded).
  const HOME_LIMIT = 50;
  const homeContent = isHome
    ? result.items
        .map((item) => containment.byId.get(item.id))
        .filter((n): n is LensNode => n != null && n.kind !== 'folder')
        // The cross-lens content filters apply here too — Home is a flat digest, so it
        // keeps just the leaves passing "Only files" AND the tag facet (both sections
        // derive from `homeContent`).
        .filter(leafPass)
    : [];
  const jumpBackNodes = homeContent
    .filter((n) => openedAtById[n.id] != null)
    .sort((a, b) =>
      (openedAtById[b.id] ?? '').localeCompare(openedAtById[a.id] ?? '')
    )
    .slice(0, HOME_LIMIT);
  const recentlyUpdatedNodes = homeContent
    .slice()
    .sort((a, b) =>
      (metaByItem[b.id]?.lastModifiedAt ?? '').localeCompare(
        metaByItem[a.id]?.lastModifiedAt ?? ''
      )
    )
    .slice(0, HOME_LIMIT);

  // The Trash lens set (ADR-0018) — the server-resolved trashed nodes, read from
  // `kbData.trash` (NOT the live `containment`, which is `deleted_at IS NULL`). Sorted
  // by name; folders + content render together (no tree — trashed roots are flat).
  // An empty/ungranted Trash is `[]` → the empty-trash copy.
  const trashNodes: LensNode[] = isTrash
    ? (kbData?.trash.items ?? [])
        .map((item) => ({
          id: item.id,
          kind: item.kind,
          title: item.title,
        }))
        .slice()
        .sort(byTitle)
    : [];
  const trashMetaByItem = kbData?.trash.metaByItem ?? {};

  // A FLAT structural lens lists its whole set as cards; the ADVANCED lens view
  // (`isLensAdvanced`) instead falls through to the TREE branch below, which walks
  // `treeContainment` (the lens subset's forest) — roots + root-loose content, with
  // folders expanding their lens children inline (Fork 3/5 + Addendum A).
  const folders = (
    isStarred && !isLensAdvanced
      ? starredNodes.filter((node) => node.kind === 'folder')
      : isShared && !isLensAdvanced
        ? sharedNodes.filter((node) => node.kind === 'folder')
        : isSharedByMe && !isLensAdvanced
          ? sharedByMeNodes.filter((node) => node.kind === 'folder')
          : isFilterScope // 'recent' lists no folders
            ? []
            : isRoot
              ? roots
              : folder
                ? childFolders(treeContainment, folder.id)
                : []
  )
    .slice()
    .sort(byTitle)
    // A content filter ON ("Only files" and/or the tag facet): a FLAT list (a flat filter
    // lens) drops all folders (a flat leaf list); a TREE render (KB browse OR an advanced
    // lens) keeps only folders whose subtree holds ≥1 KEPT leaf (prune empty branches).
    // `!isFilterScope` = a tree render.
    .filter((node) =>
      !anyLeafFilter ? true : !isFilterScope ? pruneKeep(node) : false
    );
  const shortcuts =
    // Shortcuts are OFF in an advanced lens tree for v1 (Fork 3) — it is a containment
    // projection of the lens set, not the full Drive home. Also OFF under any content
    // filter ("Only files" / the tag facet) — a symlink is not an uploaded artifact and
    // carries no tag of its own.
    (
      isFilterScope || isRoot || isLensAdvanced || anyLeafFilter
        ? []
        : (shortcutsByFolder.get(folderId ?? '') ?? [])
    )
      .slice()
      .sort(byTitle);
  const items = (
    isStarred && !isLensAdvanced
      ? starredNodes.filter((node) => node.kind !== 'folder')
      : isShared && !isLensAdvanced
        ? sharedNodes.filter((node) => node.kind !== 'folder')
        : isSharedByMe && !isLensAdvanced
          ? sharedByMeNodes.filter((node) => node.kind !== 'folder')
          : isRecent
            ? recentNodes
            : isRoot
              ? rootContent(treeContainment) // loose top-level content (no parent folder)
              : folder
                ? childContent(treeContainment, folder.id)
                : []
  )
    .slice()
    .sort(isRecent ? byRecency : byTitle)
    // The cross-lens content filters: keep only leaves passing "Only files" AND the tag
    // facet — the same predicate in flat AND advanced, so a lens shows exactly the same
    // set either way.
    .filter(leafPass);

  // The advanced lens GRID forest (ADR-0025): the SAME `treeContainment` subset the list
  // tree (`driveRows`) walks, shaped as a `LensTreeNode[]` for `LensTreeGrid` so the grid +
  // list advanced trees can never drift. Folders recurse their lens children inline (nested
  // sections + indent guides + sticky chain) so EVERY matching node is visible — never
  // hidden behind a drill (the consistency the flat lens has, plus the containment context).
  // Cycle-guarded (single-parent forest) exactly like `folderRow`. Built only when advanced.
  const buildTreeNode = (
    node: LensNode,
    ancestors: Set<string>
  ): LensTreeNode => ({
    node,
    children:
      node.kind === 'folder' && !ancestors.has(node.id)
        ? [
            ...childFolders(treeContainment, node.id)
              .slice()
              .sort(byTitle)
              // "Only files" ON → prune child folders with no descendant artifact.
              .filter((f) => (anyLeafFilter ? pruneKeep(f) : true))
              .map((f) => buildTreeNode(f, new Set(ancestors).add(node.id))),
            ...childContent(treeContainment, node.id)
              .slice()
              .sort(byTitle)
              // "Only files" ON → keep only artifact leaves.
              .filter((c) => leafPass(c))
              .map((c) => ({ node: c, children: [] as LensTreeNode[] })),
          ]
        : [],
  });
  const lensForest: LensTreeNode[] = isLensAdvanced
    ? [
        ...folders.map((f) => buildTreeNode(f, new Set<string>())),
        ...items.map((it) => ({ node: it, children: [] as LensTreeNode[] })),
      ]
    : [];

  if (!spaceId) {
    return null;
  }

  // Paste the clipboard source INTO this pane's current folder (null → top level).
  // The VIEW builds the "X (copy)" rootTitle (it owns `t`); the workbench POSTs the
  // deep-copy. Only meaningful while a clipboard is set and this pane browses 'kb'.
  const canPaste = clipboard != null && onPaste != null && scope === 'kb';
  const handlePaste = () => {
    if (clipboard && onPaste) {
      onPaste(
        folderId,
        t('graph.panel.copySuffix', { title: clipboard.title })
      );
    }
  };

  // Paste AS SHORTCUT (ADR-0015 §3): drop a `shortcut` symlink to the clipboard source
  // into THIS pane's current folder. Folder-only — a shortcut hangs off a folder, so it
  // is offered only when browsing inside one (`folderId != null`), never at root.
  const canPasteShortcut =
    canPaste && onPasteShortcut != null && folderId != null;
  const handlePasteShortcut = () => {
    if (onPasteShortcut && folderId != null) {
      onPasteShortcut(folderId);
    }
  };

  // Following a shortcut (double-click / Open) must reach the SAME surface as opening
  // the REAL target — a symlink you cannot follow is pointless (ADR-0015 §3): a folder
  // navigates IN, a text document opens the reader/editor, and every other kind opens
  // Details (where a file/video Download or a link's Open lives). Mirrors the canonical
  // item-card `onOpen` exactly, so a shortcut behaves identically to its target.
  const openShortcutTarget = (target: LensNode) => {
    if (target.kind === 'folder') {
      navigate(target.id);
    } else if (target.kind === 'text' && onOpenDocument) {
      onOpenDocument(target.id);
    } else {
      onSelect(target.id);
    }
  };

  // DnD is a 'kb' browse-only affordance (move = re-parent in the containment tree);
  // the flat lenses (Home/Starred/Recent/Shared) are read-only digests, no drag there.
  const dndEnabled = scope === 'kb';

  // Unified row set for the LIST view (folders → shortcuts → files), each with its
  // open (double-click) / details (single-click) handlers + the ⋯ actions menu —
  // the SAME behaviours as the grid cards, just rendered as table rows.
  // In BROWSE (the containment tree) folders carry recursive `subRows` so the list
  // view expands them inline (Dolphin-style). A flat filter lens (Recent/Starred/
  // Shared) has no subRows → the table stays flat. The `ancestors` set guards a
  // malformed containment cycle. The forest is single-parent (first-wins), so each
  // node appears under exactly one parent — no duplicate rows.
  const isTree = !isFilterScope;
  const itemRow = (node: LensNode): DriveRow => ({
    id: node.id,
    node,
    rowKind: 'item',
    onOpen: () =>
      node.kind === 'text' && onOpenDocument
        ? onOpenDocument(node.id)
        : onSelect(node.id),
    onDetails: () => onSelect(node.id),
    actions: (
      <NodeActionsMenu
        spaceId={spaceId}
        t={t}
        node={node}
        containment={containment}
        currentUserId={currentUserId}
        ownerUserId={metaByItem[node.id]?.ownerUserId ?? null}
        capabilities={capabilities}
        onMutated={onMutated}
        onDetails={() => onSelect(node.id)}
        onCopyToClipboard={onCopyToClipboard}
        onOpenInKb={onRevealInKbAction}
        onEdit={
          node.kind === 'text' && onEditNode
            ? () => onEditNode(node.id)
            : undefined
        }
      />
    ),
  });
  const folderRow = (node: LensNode, ancestors: Set<string>): DriveRow => ({
    id: node.id,
    node,
    rowKind: 'folder',
    onOpen: () => navigate(node.id),
    onDetails: () => onSelect(node.id),
    actions: (
      <NodeActionsMenu
        spaceId={spaceId}
        t={t}
        node={node}
        containment={containment}
        currentUserId={currentUserId}
        ownerUserId={metaByItem[node.id]?.ownerUserId ?? null}
        capabilities={capabilities}
        onMutated={onMutated}
        onDetails={() => onSelect(node.id)}
        onCopyToClipboard={onCopyToClipboard}
        onOpenInKb={onRevealInKbAction}
      />
    ),
    subRows:
      isTree && !ancestors.has(node.id)
        ? [
            ...childFolders(treeContainment, node.id)
              // "Only files" ON → prune child folders with no descendant artifact, so the
              // browse tree shows only branches that lead to a file (same as the grid).
              .filter((f) => (anyLeafFilter ? pruneKeep(f) : true))
              .map((f) => folderRow(f, new Set(ancestors).add(node.id))),
            ...childContent(treeContainment, node.id)
              // "Only files" ON → keep only artifact leaves.
              .filter((c) => leafPass(c))
              .map(itemRow),
          ]
        : undefined,
  });
  const driveRows: DriveRow[] = [
    ...folders.map((sub) => folderRow(sub, new Set<string>())),
    ...shortcuts.map((target) => ({
      id: `sc-${target.id}`,
      node: target,
      rowKind: 'shortcut' as const,
      onOpen: () => openShortcutTarget(target),
      onDetails: () => onSelect(target.id),
      // "Open in KB" jumps to the target's CANONICAL home (its real position in the
      // containment tree) — the whole point of a symlink is to reach elsewhere, so the
      // list row carries the SAME reveal the grid card does. Remove drops ONLY this
      // symlink (folder→target); the target node stays.
      actions: (
        <div className="flex items-center gap-0.5">
          {onRevealInKb ? (
            <RevealInKbButton
              reveal="always"
              onReveal={() => onRevealInKb(target.id)}
              label={t('graph.panel.openInKb')}
            />
          ) : null}
          {onRemoveShortcut && folderId != null ? (
            <RemoveShortcutButton
              onRemove={() => void onRemoveShortcut(folderId, target.id)}
              label={t('graph.drive.removeShortcut')}
            />
          ) : null}
        </div>
      ),
    })),
    ...items.map(itemRow),
  ];

  // The CURRENT ORDERED VISIBLE selectable ids (B2) — the exact visual order of what is
  // rendered NOW, so a shift-click range + "select all visible" act on precisely what the
  // user sees. Per render branch: Trash cards, the Home digest sections, the list table
  // (tree-flattened, shortcuts excluded), the advanced grid forest, or the flat grid
  // (folders then files). Shortcuts (symlinks, not nodes) are never selectable. Empty when
  // there is no multi-select host.
  const flattenRowIds = (rowSet: DriveRow[]): string[] => {
    const out: string[] = [];
    const walk = (rs: DriveRow[]) => {
      for (const r of rs) {
        if (r.rowKind !== 'shortcut') {
          out.push(r.node.id);
        }
        if (r.subRows) {
          walk(r.subRows);
        }
      }
    };
    walk(rowSet);
    return out;
  };
  const flattenForestIds = (nodes: LensTreeNode[]): string[] => {
    const out: string[] = [];
    const walk = (ns: LensTreeNode[]) => {
      for (const n of ns) {
        out.push(n.node.id);
        if (n.children.length > 0) {
          walk(n.children);
        }
      }
    };
    walk(nodes);
    return out;
  };
  const orderedVisibleIds: string[] = !multiSelect
    ? []
    : isTrash
      ? trashNodes.map((node) => node.id)
      : isHome
        ? [
            ...new Set(
              [...jumpBackNodes, ...recentlyUpdatedNodes].map((node) => node.id)
            ),
          ]
        : layout === 'list'
          ? flattenRowIds(driveRows)
          : isLensAdvanced
            ? flattenForestIds(lensForest)
            : [...folders, ...items].map((node) => node.id);

  // One card/row select checkbox — toggles this node's bulk selection (shift = a
  // contiguous range over the ordered visible ids). Absent host → no checkbox.
  const renderSelect = (
    id: string,
    title: string,
    placement: 'grid' | 'list' | 'inline'
  ) =>
    multiSelect ? (
      <SelectCheckbox
        placement={placement}
        checked={multiSelect.isSelected(id)}
        label={t('graph.select.toggle', { title })}
        onToggle={(shiftKey) =>
          shiftKey
            ? multiSelect.toggleRange(id, orderedVisibleIds)
            : multiSelect.toggle(id)
        }
      />
    ) : undefined;

  // How many of the currently visible ids are selected (drives the header tri-state).
  const selectedVisibleCount = multiSelect
    ? orderedVisibleIds.filter((id) => multiSelect.isSelected(id)).length
    : 0;

  // The shared Drive left-rail (lens nav + Sections + the "New" launcher), now a
  // standalone component so the search lens renders the IDENTICAL chrome (ADR-0024
  // §5). It walks `treeContainment` (the lens subset's forest when advanced, else the
  // full graph) for the Sections roots, exactly as the inline rail did. The scope
  // switch routes through `applyScope`; the uncontrolled fallback (no workbench owning
  // the scope) roots the local folder when switching to 'kb'.
  const sidebar = (
    <DriveSidebar
      t={t}
      scope={scope}
      onScopeChange={(next) => {
        applyScope(next);
        if (!controlled && next === 'kb') {
          navigate(null);
        }
      }}
      onNavigate={navigate}
      folderId={folderId}
      containment={treeContainment}
      spaceId={spaceId}
      maxUploadBytes={kbData?.maxUploadBytes}
      onMutated={onMutated}
    />
  );

  const toolbarLeft = (
    <div className="flex min-w-0 items-center gap-1 text-sm">
      {isFilterScope || isStructuralLens ? (
        // A flat filter lens (Recent) is not a tree location — a single inert crumb
        // stands in for the folder path. A structural lens (flat OR advanced) keeps its
        // lens label as the ROOT crumb — the advanced tree is still a projection of the
        // LENS set, not the Knowledge-base root. In an advanced lens tree the crumb is
        // CLICKABLE (returns to the lens root) once drilled, exactly as the kb-browse
        // root crumb is — same scope, just a narrowed tree.
        (() => {
          const lensIcon = isHome ? (
            <House className="size-3.5" aria-hidden />
          ) : isStarred ? (
            <Star className="size-3.5" aria-hidden />
          ) : isShared ? (
            <Users className="size-3.5" aria-hidden />
          ) : isSharedByMe ? (
            <Send className="size-3.5" aria-hidden />
          ) : isTrash ? (
            <Trash2 className="size-3.5" aria-hidden />
          ) : (
            <Clock className="size-3.5" aria-hidden />
          );
          const lensLabel = isHome
            ? t('graph.drive.navHome')
            : isStarred
              ? t('graph.drive.navStarred')
              : isShared
                ? t('graph.drive.navShared')
                : isSharedByMe
                  ? t('graph.drive.navSharedByMe')
                  : isTrash
                    ? t('graph.drive.navTrash')
                    : t('graph.drive.navRecent');
          // Drilled into an advanced lens tree → the lens label is a button back to the
          // lens root (keeps the lens scope). Otherwise an inert label.
          return isLensAdvanced && !isRoot ? (
            <Button
              type="button"
              variant="crumb"
              size={null}
              onClick={() => navigate(null)}
              className="flex shrink-0 items-center gap-1.5 font-semibold"
            >
              {lensIcon}
              {lensLabel}
            </Button>
          ) : (
            <span className="text-foreground flex shrink-0 items-center gap-1.5 font-semibold">
              {lensIcon}
              {lensLabel}
            </span>
          );
        })()
      ) : dndEnabled ? (
        // The root crumb is also a drop target: dropping a node here re-parents it
        // to the top level (drop the current contains edge, add no new one).
        <RootDropZone>
          {(over) => (
            <Button
              type="button"
              variant="crumb"
              size={null}
              onClick={() => navigate(null)}
              title={t('graph.drive.dropOnRoot')}
              className={cn(
                'shrink-0 rounded px-1',
                isRoot && 'text-foreground font-semibold',
                over && 'bg-accent text-foreground ring-ring/50 ring-1'
              )}
            >
              {t('graph.lens.knowledgeBase')}
            </Button>
          )}
        </RootDropZone>
      ) : (
        <Button
          type="button"
          variant="crumb"
          size={null}
          onClick={() => navigate(null)}
          className={cn('shrink-0', isRoot && 'text-foreground font-semibold')}
        >
          {t('graph.lens.knowledgeBase')}
        </Button>
      )}
      {/* Full ancestry path (deliberate delta: the prototype showed only the
            immediate folder). Each ancestor is a clickable crumb; the current one
            is bold and inert. */}
      {!isFilterScope && !isRoot && folder
        ? // In the advanced Shared tree the path walks the SHARED subset's forest
          // (`treeContainment`) so the breadcrumb never reaches a non-shared ancestor;
          // kb-browse walks the full graph forest.
          pathTo(treeContainment, folder.id).map((crumb, index, crumbs) => {
            const isCurrent = index === crumbs.length - 1;
            return (
              <React.Fragment key={crumb.id}>
                <ChevronRight
                  className="text-muted-foreground size-3.5 shrink-0"
                  aria-hidden
                />
                {isCurrent ? (
                  <span className="truncate font-semibold">{crumb.title}</span>
                ) : (
                  <Button
                    type="button"
                    variant="crumb"
                    size={null}
                    onClick={() => navigate(crumb.id)}
                    className="truncate"
                  >
                    {crumb.title}
                  </Button>
                )}
              </React.Fragment>
            );
          })
        : null}
      {/* current-folder actions (deliberate delta: the card ⋯ acts on a CHILD
            folder; this acts on the folder you are IN) → the shared action menu,
            with Details opening the panel. */}
      {!isFilterScope && !isRoot && folder ? (
        <span className="ml-0.5 shrink-0">
          <NodeActionsMenu
            spaceId={spaceId}
            t={t}
            node={folder}
            containment={containment}
            currentUserId={currentUserId}
            ownerUserId={metaByItem[folder.id]?.ownerUserId ?? null}
            capabilities={capabilities}
            onMutated={onMutated}
            onDetails={() => onSelect(folder.id)}
            onCopyToClipboard={onCopyToClipboard}
            onOpenInKb={onRevealInKbAction}
          />
        </span>
      ) : null}
    </div>
  );

  // The cross-lens "Only files" toggle (ADR-0026 render) — passed as the shared
  // LensToolbar's `filter` prop, which renders it FIRST in the right cluster with a
  // trailing vertical rule (the toolbar owns the frame). A lens-agnostic chip (not a
  // content row → never pushes the table down). ON: flat lenses filter to uploaded
  // artifacts; a tree render prunes to branches with ≥1 file. NOT in Trash (undefined →
  // the toolbar skips the slot + its separator). Carries the visible-slice Hint. Passing
  // it as a first-class prop is what puts the chip on EVERY lens by construction.
  const toolbarFilter = !isTrash ? (
    <ToggleChip
      label={t('graph.drive.filterUploaded')}
      pressed={uploadedOnly}
      onPressedChange={setUploadedOnly}
      icon={FileUp}
      hint={t('graph.drive.folderSizeHint')}
    />
  ) : undefined;

  // Clipboard indicator (Dolphin model) — two states of the SAME affordance:
  //  • ACTIVE (canPaste: clipboard set AND this pane browses 'kb') → the full chip: a
  //    clickable Paste (source INTO this pane's current folder) + the ✕ clear. The
  //    split-pane's payoff: Copy in A, navigate B, Paste here.
  //  • READ-ONLY (clipboard set but no paste target — a flat lens like Shared/Starred/
  //    Recent/Trash) → a muted "on your clipboard" hint: no Paste (nowhere to paste into
  //    here), but the ✕ clear IS present so the buffer can be cleared from ANY lens (not
  //    just by navigating back to KB / Escape). Escape still clears globally (the
  //    workbench keydown handler is scope-independent). Rendered via the toolbar's
  //    `trailing` slot (bespoke to Drive).
  const toolbarClipboard =
    clipboard != null ? (
      canPaste ? (
        <div className="flex items-center overflow-hidden rounded-md border">
          <Hint
            label={t(isRoot ? 'graph.drive.pasteRoot' : 'graph.drive.paste', {
              title: clipboard.title,
            })}
          >
            <Button
              type="button"
              variant="ghost"
              onClick={handlePaste}
              aria-label={t(
                isRoot ? 'graph.drive.pasteRoot' : 'graph.drive.paste',
                { title: clipboard.title }
              )}
              className="hover:bg-accent flex h-7 items-center gap-1.5 rounded-none px-2 text-sm font-normal"
            >
              <ClipboardPaste className="size-[15px]" aria-hidden />
              <span className="max-w-[120px] truncate">{clipboard.title}</span>
            </Button>
          </Hint>
          {canPasteShortcut ? (
            <Hint
              label={t('graph.drive.pasteShortcut', { title: clipboard.title })}
            >
              <Button
                type="button"
                variant="ghost"
                onClick={handlePasteShortcut}
                aria-label={t('graph.drive.pasteShortcut', {
                  title: clipboard.title,
                })}
                className="text-muted-foreground hover:bg-accent hover:text-foreground border-l-border grid h-7 w-7 place-items-center rounded-none border-l p-0"
              >
                <FolderSymlink className="size-[15px]" aria-hidden />
              </Button>
            </Hint>
          ) : null}
          <Hint label={t('graph.drive.pasteClear')}>
            <Button
              type="button"
              variant="ghost"
              onClick={onClearClipboard}
              aria-label={t('graph.drive.pasteClear')}
              className="text-muted-foreground hover:bg-accent hover:text-foreground border-l-border grid h-7 w-7 place-items-center rounded-none border-l p-0"
            >
              <X className="size-[14px]" aria-hidden />
            </Button>
          </Hint>
        </div>
      ) : (
        <div className="text-muted-foreground flex items-center overflow-hidden rounded-md border">
          <Hint
            label={t('graph.drive.clipboardHint', {
              title: clipboard.title,
            })}
          >
            <div
              aria-label={t('graph.drive.clipboardHint', {
                title: clipboard.title,
              })}
              className="flex h-7 items-center gap-1.5 px-2 text-sm select-none"
            >
              <Clipboard className="size-[15px]" aria-hidden />
              <span className="max-w-[120px] truncate">{clipboard.title}</span>
            </div>
          </Hint>
          <Hint label={t('graph.drive.pasteClear')}>
            <Button
              type="button"
              variant="ghost"
              onClick={onClearClipboard}
              aria-label={t('graph.drive.pasteClear')}
              className="hover:bg-accent hover:text-foreground border-l-border grid h-7 w-7 place-items-center rounded-none border-l p-0"
            >
              <X className="size-[14px]" aria-hidden />
            </Button>
          </Hint>
        </div>
      )
    ) : null;

  // Upload creates into the current location — meaningless in the Trash lens (a holding
  // state for trashed nodes, not a place to author into).
  const toolbarUpload = !isTrash ? (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        setCreateRequest({ kind: 'file', parentFolderId: folderId })
      }
    >
      <Upload className="size-[15px]" aria-hidden />
      {t('graph.drive.upload')}
    </Button>
  ) : undefined;

  // Empty Trash (B2) — purge ALL trashed nodes (the workbench owns the mandatory confirm
  // + the batch fan-out; this button just asks it to open). Only in the Trash lens, only
  // when the trash is non-empty, and only when the workbench wired the callback. Occupies
  // the toolbar's action slot (Upload is meaningless in Trash).
  const toolbarEmptyTrash =
    isTrash && onEmptyTrash && trashNodes.length > 0 ? (
      <Button
        variant="outline"
        size="sm"
        onClick={onEmptyTrash}
        className="text-destructive hover:text-destructive"
      >
        <Trash2 className="size-[15px]" aria-hidden />
        {t('graph.trash.emptyTrash')}
      </Button>
    ) : undefined;

  // The lens display-mode toggle (ADR-0022 Fork 4 + Addendum A): Flat ↔ Advanced, shown
  // ONLY on a STRUCTURAL lens (Shared / Shared-by-me / Starred), NEVER on Recent/Home.
  // When the space is NOT entitled it renders DISABLED, wrapped in a Hint with the upsell
  // copy — NEVER hidden (the locked control IS the upsell, Fork 2). The server clamps
  // `?view=` to 'flat' on a locked plan, so even a forged URL stays flat.
  const toolbarLensView =
    isStructuralLens && onLensViewChange ? (
      <LensViewToggle
        t={t}
        lensView={lensView}
        onLensViewChange={onLensViewChange}
        entitled={advancedStructuralEntitled}
      />
    ) : undefined;

  const toolbarLayout = (
    <LayoutToggle
      layout={layout}
      onLayoutChange={applyLayout}
      gridLabel={t('graph.drive.layoutGrid')}
      listLabel={t('graph.drive.layoutList')}
    />
  );

  const toolbarSplit =
    onToggleSplit && scope === 'kb' ? (
      <Hint
        label={t(split ? 'graph.drive.splitClose' : 'graph.drive.splitOpen')}
      >
        <Button
          type="button"
          variant="segmented"
          onClick={onToggleSplit}
          aria-label={t(
            split ? 'graph.drive.splitClose' : 'graph.drive.splitOpen'
          )}
          aria-pressed={split}
          className="border-border grid h-7 w-[30px] place-items-center rounded-md border p-0"
        >
          <Columns2 className="size-[15px]" aria-hidden />
        </Button>
      </Hint>
    ) : undefined;

  const toolbar = (
    <LensToolbar
      left={toolbarLeft}
      filter={toolbarFilter}
      trailing={toolbarClipboard}
      upload={toolbarEmptyTrash ?? toolbarUpload}
      lensView={toolbarLensView}
      layout={toolbarLayout}
      split={toolbarSplit}
    />
  );

  // One content card, reused by the flat items grid and the "For you" home sections.
  // In 'kb' browse it is a drag source (re-parent on drop); flat lenses render plain.
  const renderItemCard = (item: LensNode, whenIso?: string) => {
    const card = (
      <ItemCard
        key={item.id}
        t={t}
        node={item}
        attributes={attributesByItem[item.id]}
        meta={metaByItem[item.id]}
        tags={tagsByItem[item.id]}
        currentUserId={currentUserId}
        layout={layout}
        selected={item.id === selectedId}
        sharedBadge={renderAccessBadge(item.id)}
        when={whenIso && mounted ? formatWhen(whenIso) : undefined}
        select={renderSelect(
          item.id,
          item.title,
          layout === 'list' ? 'list' : 'grid'
        )}
        onOpen={() =>
          item.kind === 'text' && onOpenDocument
            ? onOpenDocument(item.id)
            : onSelect(item.id)
        }
        onDetails={() => onSelect(item.id)}
        footer={
          isSharedByMe ? (
            <GranteeSummary
              t={t}
              grantees={sharedByMeByResource.get(item.id) ?? []}
            />
          ) : isShared && shareMechanism[item.id] ? (
            <ShareMechanismBadge t={t} mechanism={shareMechanism[item.id]!} />
          ) : undefined
        }
        star={
          <>
            <StarButton
              starred={starredSet.has(item.id)}
              onToggle={() => toggleStar(item.id, !starredSet.has(item.id))}
              label={t(
                starredSet.has(item.id)
                  ? 'graph.drive.unstar'
                  : 'graph.drive.star'
              )}
            />
            {onRevealInKbAction ? (
              <RevealInKbButton
                onReveal={() => onRevealInKbAction(item.id)}
                label={t('graph.panel.openInKb')}
              />
            ) : null}
          </>
        }
        actions={
          <NodeActionsMenu
            spaceId={spaceId}
            t={t}
            node={item}
            containment={containment}
            currentUserId={currentUserId}
            ownerUserId={metaByItem[item.id]?.ownerUserId ?? null}
            capabilities={capabilities}
            onMutated={onMutated}
            onDetails={() => onSelect(item.id)}
            onCopyToClipboard={onCopyToClipboard}
            onOpenInKb={onRevealInKbAction}
            onEdit={
              item.kind === 'text' && onEditNode
                ? () => onEditNode(item.id)
                : undefined
            }
            triggerClassName={CARD_ACTION_TRIGGER}
          />
        }
      />
    );
    if (!dndEnabled) {
      return card;
    }
    return (
      <DraggableItemCard
        key={item.id}
        {...(card.props as React.ComponentProps<typeof ItemCard>)}
        dragData={{
          type: 'node',
          nodeId: item.id,
          title: item.title,
          kind: item.kind,
        }}
      />
    );
  };

  // "For you" — a personal digest: two sections of content cards. Shown instead of the
  // browse tree / flat list when scope='home'. Respects the grid/list toggle (cards vs
  // list rows); the sortable TABLE is browse-only — it does not fit a 2-section digest.
  const homeSection = (
    label: string,
    nodes: LensNode[],
    whenOf: (node: LensNode) => string | undefined
  ) =>
    nodes.length > 0 ? (
      <>
        <SectionLabel className="mt-[18px] first:mt-0">{label}</SectionLabel>
        <div className={layout === 'grid' ? GRID_WRAP : LIST_WRAP}>
          {nodes.map((node) => renderItemCard(node, whenOf(node)))}
        </div>
      </>
    ) : null;

  // One trashed row — the node's title + meta line, with Restore + Purge actions
  // (no star, no ⋯ menu, no open/navigate: a trashed node is a holding-state entry,
  // not a browsable item). Purge confirms and surfaces the in-use rejection.
  const renderTrashCard = (node: LensNode) => (
    <TrashCard
      key={node.id}
      t={t}
      node={node}
      meta={trashMetaByItem[node.id]}
      currentUserId={currentUserId}
      layout={layout}
      select={renderSelect(node.id, node.title, 'inline')}
      onRestore={onRestore}
      onPurge={onPurge}
    />
  );

  // The "select all visible" header (B2) — a tri-state checkbox over the ordered visible
  // ids: all → clear, some/none → select all. Shown only with a multi-select host and a
  // non-empty visible set. Composes above every lens's content (browse, flat lenses,
  // Home, Trash), so bulk selection has a single always-present entry point.
  const selectAllHeader =
    multiSelect && orderedVisibleIds.length > 0 ? (
      <div className="mb-3 flex items-center gap-2">
        <Checkbox
          aria-label={t('graph.bulk.selectAll')}
          checked={
            selectedVisibleCount === 0
              ? false
              : selectedVisibleCount === orderedVisibleIds.length
                ? true
                : 'indeterminate'
          }
          onClick={() =>
            selectedVisibleCount === orderedVisibleIds.length
              ? multiSelect.clear()
              : multiSelect.selectAll(orderedVisibleIds)
          }
        />
        <span className="text-muted-foreground text-xs">
          {t('graph.bulk.selectAll')}
        </span>
      </div>
    ) : null;

  const main = (
    <>
      {selectAllHeader}
      {isTrash ? (
        trashNodes.length === 0 ? (
          <EmptyState>{t('graph.trash.empty')}</EmptyState>
        ) : (
          <div className={layout === 'grid' ? GRID_WRAP : LIST_WRAP}>
            {trashNodes.map(renderTrashCard)}
          </div>
        )
      ) : isHome ? (
        jumpBackNodes.length === 0 && recentlyUpdatedNodes.length === 0 ? (
          <EmptyState>{t('graph.drive.homeEmpty')}</EmptyState>
        ) : (
          <>
            {homeSection(
              t('graph.drive.homeJumpBackIn'),
              jumpBackNodes,
              (n) => openedAtById[n.id]
            )}
            {homeSection(
              t('graph.drive.homeRecentlyUpdated'),
              recentlyUpdatedNodes,
              (n) => metaByItem[n.id]?.lastModifiedAt
            )}
          </>
        )
      ) : (
        <>
          {!isFilterScope && isRoot ? (
            <div className="text-muted-foreground mb-2 text-[13px]">
              {t('graph.drive.allSections', { count: roots.length })}
            </div>
          ) : null}

          {/* "Shared with me" mechanism facet (ADR-0021 Part C) — a chip row that
              filters the shared set by mechanism. Only rendered in the 'shared' lens,
              and only when ≥2 mechanisms are present (a single-mechanism set has
              nothing to filter). Display over the precomputed annotation. */}
          {isShared && presentMechanisms.length > 1 ? (
            <ShareFacetChips
              t={t}
              mechanisms={presentMechanisms}
              active={shareFacet}
              onChange={setShareFacet}
            />
          ) : null}

          {/* Tag facet (ADR-0003 Variant B) — a chip row of the tags PRESENT on the
              resolved canvas (gap-doc :28). Multi-select (union): toggling a tag narrows
              the canvas to content carrying ANY active tag, reusing the same prune the
              "Only files" filter uses (so the browse tree prunes to tagged branches).
              "All" clears; an active tag is pressed + check-marked. A client display
              filter over `tagsByItem`, never a fence. Hidden in Trash / when the canvas
              carries no tags. */}
          {!isTrash && resolvedTags.length > 0 ? (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground mr-0.5 inline-flex items-center gap-1 text-xs">
                <TagIcon className="size-3" aria-hidden />
                {t('graph.lens.filterTag')}
              </span>
              <ToggleChip
                label={t('graph.drive.facetAll')}
                pressed={!tagFacetActive}
                onPressedChange={clearTagFacet}
              />
              {resolvedTags.map((tag) => {
                const on = tagFacet.has(tag.id);
                return (
                  <ToggleChip
                    key={tag.id}
                    label={tag.title}
                    pressed={on}
                    onPressedChange={() => toggleTagFacet(tag.id)}
                    icon={on ? Check : undefined}
                  />
                );
              })}
            </div>
          ) : null}

          {/* Status facet (workflow lifecycle, B1) — a chip row that narrows the canvas
              to one status (draft/active/archived), reusing the SAME leaf-prune as the
              tag facet + "Only files". Single-select; "All" clears. Shown only outside
              Trash and only when the canvas carries ≥2 distinct content statuses (a
              single-status set has nothing to filter). Display over `LensNode.status`. */}
          {!isTrash && presentStatuses.size > 1 ? (
            <StatusFacetChips
              t={t}
              active={statusFacet}
              onChange={setStatusFacet}
            />
          ) : null}

          {/* contents — a sortable TABLE in list mode, cards in grid mode */}
          {layout === 'list' ? (
            driveRows.length > 0 ? (
              <LensListTable
                // Remount when the column SET changes (Recent's "Viewed" column vs the
                // "Modified" column elsewhere): the table's sort state is seeded once at
                // mount, so without this it keeps a stale `{id:'viewed'}` sort after
                // leaving Recent and TanStack throws "Column 'viewed' does not exist".
                // ALSO remount when the structural mode flips (flat ↔ tree) — a Shared
                // lens toggling Flat↔Advanced (ADR-0022) changes `tree` in place; without
                // a fresh mount TanStack's expanded-row model leaves a stale expand
                // control behind (a detached duplicate). The mode is part of the table's
                // identity, so it keys the remount.
                key={
                  isRecent ? 'recent' : isTree ? 'browse-tree' : 'browse-flat'
                }
                rows={driveRows}
                tree={isTree}
                t={t}
                metaByItem={metaByItem}
                currentUserId={currentUserId}
                selectedId={selectedId}
                starredSet={starredSet}
                onToggleStar={toggleStar}
                // In Recent the 4th column is "Viewed" (when I last opened it) instead of
                // "Modified" — that is why the item is here; pass the overlay so the
                // column + sort read it.
                recentOpenedAt={isRecent ? openedAtById : null}
                // Recent defaults to most-recently-VIEWED first (still re-sortable by any
                // column); every other scope sorts by name.
                defaultSorting={
                  isRecent
                    ? [{ id: 'viewed', desc: true }]
                    : [{ id: 'name', desc: false }]
                }
                dndEnabled={dndEnabled}
                // The access-status badge per row (ADR-0023 §7a) — the SAME globe-XOR-people
                // taxonomy the cards use (globe precedence), so the list mirrors the grid.
                sharedBadgeFor={(node) => renderAccessBadge(node.id) ?? null}
                // The size column (ADR-0026 render): a file/video's own bytes, a folder's
                // recursive VISIBLE-descendant sum, "—" otherwise — off the shared index.
                sizeOf={sizeOf}
                // Multi-select (B2): a leading checkbox column; shift = a range over the
                // ordered visible ids the view threads in. Omitted → no column.
                selection={
                  multiSelect
                    ? {
                        isSelected: multiSelect.isSelected,
                        onToggle: (id, shiftKey) =>
                          shiftKey
                            ? multiSelect.toggleRange(id, orderedVisibleIds)
                            : multiSelect.toggle(id),
                        label: (title) => t('graph.select.toggle', { title }),
                      }
                    : undefined
                }
              />
            ) : null
          ) : (
            <>
              {isLensAdvanced ? (
                // ADVANCED lens GRID (ADR-0025): the lens subset as a recursive tree-grid —
                // every matching node visible (nested folder sections + indent guides +
                // sticky ancestor chain), not hidden behind a drill. Folders carry the SAME
                // jump-to-KB the cards do, even when empty.
                lensForest.length > 0 ? (
                  <LensTreeGrid
                    roots={lensForest}
                    renderLeaf={renderItemCard}
                    // Each breadcrumb path folder reveals itself in the KB on click.
                    onJumpToFolder={onRevealInKb}
                    folderTestId="drive-advanced-tree-folder"
                  />
                ) : null
              ) : (
                <>
                  {/* folders + shortcuts */}
                  {folders.length > 0 || shortcuts.length > 0 ? (
                    <>
                      {!isRoot || isFilterScope ? (
                        <SectionLabel>{t('graph.canvas.folders')}</SectionLabel>
                      ) : null}
                      <div
                        className={layout === 'grid' ? GRID_WRAP : LIST_WRAP}
                      >
                        {folders.map((sub) => {
                          const folderShared = sharedOut(
                            containment,
                            sub.id,
                            isGranted
                          );
                          const folderGrantees =
                            sharedByMeByResource.get(sub.id) ?? [];
                          const folderCardProps = {
                            title: sub.title,
                            subtitle: t('graph.drive.itemsCount', {
                              count:
                                childFolders(treeContainment, sub.id).length +
                                childContent(treeContainment, sub.id).length,
                            }),
                            layout,
                            onOpen: () => navigate(sub.id),
                            onDetails: () => onSelect(sub.id),
                            // This folder-card section renders only in grid layout (the
                            // list layout goes through LensListTable above).
                            select: renderSelect(sub.id, sub.title, 'grid'),
                            sharedBadge: renderAccessBadge(sub.id),
                            // The "placement = sharing" hint shows only when THIS folder
                            // itself confers access (a direct grant or a broadcast floor) —
                            // dropping a node here would share it. A folder that is shared
                            // only via a granted ANCESTOR gets the badge (above) but not the
                            // hint (the hint is about what placing INTO this folder does, and
                            // the ancestor already covers that one level up).
                            folderHint:
                              folderShared.direct ||
                              metaByItem[sub.id]?.visibility === 'space' ||
                              metaByItem[sub.id]?.visibility ===
                                'organization' ? (
                                <SharedFolderHint
                                  t={t}
                                  visibility={metaByItem[sub.id]?.visibility}
                                  grantees={folderGrantees}
                                />
                              ) : undefined,
                            footer: isSharedByMe ? (
                              <GranteeSummary
                                t={t}
                                grantees={
                                  sharedByMeByResource.get(sub.id) ?? []
                                }
                              />
                            ) : isShared && shareMechanism[sub.id] ? (
                              <ShareMechanismBadge
                                t={t}
                                mechanism={shareMechanism[sub.id]!}
                              />
                            ) : undefined,
                            star: (
                              <>
                                <StarButton
                                  starred={starredSet.has(sub.id)}
                                  onToggle={() =>
                                    toggleStar(sub.id, !starredSet.has(sub.id))
                                  }
                                  label={t(
                                    starredSet.has(sub.id)
                                      ? 'graph.drive.unstar'
                                      : 'graph.drive.star'
                                  )}
                                />
                                {onRevealInKbAction ? (
                                  <RevealInKbButton
                                    onReveal={() => onRevealInKbAction(sub.id)}
                                    label={t('graph.panel.openInKb')}
                                  />
                                ) : null}
                              </>
                            ),
                            actions: (
                              <NodeActionsMenu
                                spaceId={spaceId}
                                t={t}
                                node={sub}
                                containment={containment}
                                currentUserId={currentUserId}
                                ownerUserId={
                                  metaByItem[sub.id]?.ownerUserId ?? null
                                }
                                capabilities={capabilities}
                                onMutated={onMutated}
                                onDetails={() => onSelect(sub.id)}
                                onCopyToClipboard={onCopyToClipboard}
                                onOpenInKb={onRevealInKbAction}
                                triggerClassName={CARD_ACTION_TRIGGER}
                              />
                            ),
                          };
                          return dndEnabled ? (
                            <DraggableDroppableFolderCard
                              key={sub.id}
                              {...folderCardProps}
                              dragData={{
                                type: 'node',
                                nodeId: sub.id,
                                title: sub.title,
                                kind: 'folder',
                              }}
                            />
                          ) : (
                            <FolderCard key={sub.id} {...folderCardProps} />
                          );
                        })}
                        {shortcuts.map((target) => (
                          <FolderCard
                            key={`sc-${target.id}`}
                            title={target.title}
                            subtitle={
                              target.kind === 'folder'
                                ? t('graph.drive.shortcutFolder')
                                : t('graph.drive.shortcut')
                            }
                            layout={layout}
                            shortcut
                            // The TARGET's kind icon (doc/file/video/link/folder) + the
                            // shortcut arrow — telegraphs WHAT it points at, not a
                            // uniform folder-symlink glyph (ADR-0015 §3).
                            icon={iconForKind(target.kind)}
                            onOpen={() => openShortcutTarget(target)}
                            onDetails={() => onSelect(target.id)}
                            actions={
                              // A shortcut points ELSEWHERE, so "Open in KB" is meaningful even in
                              // the KB lens — it jumps to the target's CANONICAL home (target.id).
                              // Remove drops ONLY this symlink (folder→target), never the target.
                              <>
                                {onRevealInKb ? (
                                  <RevealInKbButton
                                    onReveal={() => onRevealInKb(target.id)}
                                    label={t('graph.panel.openInKb')}
                                  />
                                ) : null}
                                {onRemoveShortcut && folderId != null ? (
                                  <RemoveShortcutButton
                                    reveal="hover"
                                    onRemove={() =>
                                      void onRemoveShortcut(folderId, target.id)
                                    }
                                    label={t('graph.drive.removeShortcut')}
                                  />
                                ) : null}
                              </>
                            }
                          />
                        ))}
                      </div>
                    </>
                  ) : null}

                  {/* files / docs */}
                  {items.length > 0 ? (
                    <>
                      <SectionLabel className="mt-[18px]">
                        {t('graph.canvas.files')}
                      </SectionLabel>
                      <div
                        className={layout === 'grid' ? GRID_WRAP : LIST_WRAP}
                      >
                        {items.map((it) => renderItemCard(it))}
                      </div>
                    </>
                  ) : null}
                </>
              )}
            </>
          )}

          {/* empty states */}
          {isStarred && folders.length === 0 && items.length === 0 ? (
            <EmptyState>{t('graph.drive.starredEmpty')}</EmptyState>
          ) : null}
          {isRecent && items.length === 0 ? (
            <EmptyState>{t('graph.drive.recentEmpty')}</EmptyState>
          ) : null}
          {isShared && folders.length === 0 && items.length === 0 ? (
            <EmptyState>
              {/* A facet filtered the set to nothing → "nothing shared this way";
                  an empty lens with no facet → the generic shared-empty copy. */}
              {shareFacet != null
                ? t('graph.drive.facetFilteredEmpty')
                : t('graph.drive.sharedEmpty')}
            </EmptyState>
          ) : null}
          {isSharedByMe && folders.length === 0 && items.length === 0 ? (
            <EmptyState>{t('graph.drive.sharedByMeEmpty')}</EmptyState>
          ) : null}
          {/* A tag facet that filtered the KB-browse canvas to nothing → "nothing here
              matches this tag" (the same copy the share facet uses), taking precedence
              over the generic empty-editor / empty-folder copy below. */}
          {!isFilterScope &&
          tagFacetActive &&
          folders.length === 0 &&
          items.length === 0 ? (
            <EmptyState>{t('graph.drive.facetFilteredEmpty')}</EmptyState>
          ) : null}
          {!isFilterScope &&
          !tagFacetActive &&
          isRoot &&
          folders.length === 0 &&
          items.length === 0 ? (
            <EmptyState>{t('graph.lens.emptyEditor')}</EmptyState>
          ) : null}
          {!isFilterScope &&
          !tagFacetActive &&
          !isRoot &&
          folders.length === 0 &&
          items.length === 0 ? (
            <EmptyState>{t('graph.drive.folderEmpty')}</EmptyState>
          ) : null}
        </>
      )}
    </>
  );

  return (
    <>
      <WorkbenchShell
        // The split's SECOND pane shares the first pane's sidebar (one nav for both),
        // so it renders sidebar-less — just its own toolbar + canvas.
        panel={
          hideSidebar
            ? undefined
            : {
                kind: 'fixed',
                width: 230,
                'aria-label': t('graph.drive.navKnowledgeBase'),
                children: sidebar,
              }
        }
        toolbar={toolbar}
        main={
          dndEnabled ? (
            <CanvasRootDropZone folderId={folderId}>{main}</CanvasRootDropZone>
          ) : (
            main
          )
        }
      />

      <CreateResource
        spaceId={spaceId}
        t={t}
        containment={containment}
        maxUploadBytes={kbData?.maxUploadBytes}
        request={createRequest}
        onOpenChange={(open) => {
          if (!open) {
            setCreateRequest(null);
          }
        }}
        onCreated={onMutated}
      />
    </>
  );
}
