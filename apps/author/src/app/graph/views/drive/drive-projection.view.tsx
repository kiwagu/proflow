'use client';

import { useDraggable, useDroppable } from '@dnd-kit/core';
import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import { CardTile } from '@workspace/ui/components/card-tile';
import { ConfirmDialog } from '@workspace/ui/components/confirm-dialog';
import { DataTable, type ColumnDef } from '@workspace/ui/components/data-table';
import { EmptyState } from '@workspace/ui/components/empty-state';
import { EntityAvatar } from '@workspace/ui/components/entity-avatar';
import { Hint } from '@workspace/ui/components/hint';
import { RowActionButton } from '@workspace/ui/components/platform/row-action-button';
import { WorkbenchShell } from '@workspace/ui/components/workbench-shell';
import { byText } from '@workspace/ui/lib/sort';
import { cn } from '@workspace/ui/lib/utils';
import {
  ArrowUpRight,
  ChevronRight,
  Clipboard,
  ClipboardPaste,
  Clock,
  Columns2,
  Folder,
  Globe,
  House,
  FolderSymlink,
  Info,
  Lock,
  Radio,
  RotateCcw,
  Send,
  Star,
  Target,
  Trash2,
  Upload,
  UserCheck,
  Users,
  UsersRound,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import * as React from 'react';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';

import type {
  KbAttributes,
  NodeMeta,
  ResourceFloor,
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
  broadcastOut,
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
  formatNodeMeta,
  iconForKind,
  kindLabel,
  ownerLabel,
} from '@/app/graph/presentation';
import {
  CreateResource,
  type CreateRequest,
} from '@/app/graph/create-resource.view';
import { DriveSidebar } from '@/app/graph/views/drive/drive-sidebar';
import { LayoutToggle } from '@/app/graph/views/drive/layout-toggle';
import { LensTreeGrid } from '@/app/graph/views/drive/lens-tree-grid';
import type { LensTreeNode } from '@/app/graph/views/drive/lens-tree-grid';
import { modifiedCell, typeCell } from '@/app/graph/views/drive/lens-row-cells';
import { LensViewToggle } from '@/app/graph/views/drive/lens-view-toggle';
import { NodeActionsMenu } from '@/app/graph/node-actions-menu';
import { usePaneId, useDriveDragState } from '@/app/graph/drive-dnd';
import type { DriveDragData, DriveDropData } from '@/app/graph/drive-dnd';

// Hover-reveal classes for a card's `⋯` action trigger (stays visible while open).
const CARD_ACTION_TRIGGER =
  'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100';

// Single vs double click on a card (the Google-Drive split): single click opens
// the shared Details panel, double click OPENS the node (folder → navigate in,
// document → read-view). A lone click defers to Details on a short timer so a
// double-click can cancel it — opening never flashes the Details panel first.
// Keyboard Enter on the card button fires a `detail === 0` click, so it lands on
// Details (the safe, reversible action); opening by keyboard is one Enter further,
// from the panel.
//
// Discrimination is on the click's running count (`event.detail`), NOT the separate
// `dblclick` event: the 2nd click of a pair arrives as `detail === 2` and Opens
// directly. Relying on `dblclick` was fragile — the browser drops it whenever a
// re-render swaps the card element between the two clicks (e.g. the reader's
// focus-refetch firing after the editor round-trip), which silently degraded the
// split. There is also no long-lived "armed" flag to wedge: each click cancels and
// reschedules its own pending Details, so the split can never fall back to
// open-on-single-click.
const CARD_DOUBLE_CLICK_MS = 250;

function useCardOpen(onDetails: () => void, onOpen: () => void) {
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = React.useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  React.useEffect(() => cancel, [cancel]);
  return {
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      if (event.detail > 1) {
        cancel(); // 2nd click of a pair → Open, drop the pending Details.
        onOpen();
        return;
      }
      cancel();
      timer.current = setTimeout(() => {
        timer.current = null;
        onDetails();
      }, CARD_DOUBLE_CLICK_MS);
    },
  };
}

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

type DriveLayout = 'grid' | 'list';

/**
 * The "Shared with me" mechanism presentation table (ADR-0021 Part C) — maps each
 * winning mechanism to its badge icon, its short label, and a Hint explaining it. The
 * order is the precedence order (most deliberate first: personal > cohort > broadcast)
 * — it drives BOTH the facet chip row sequence and which chips appear (a chip shows
 * only when its mechanism is present in the shared set). Labels/hints are LITERAL i18n
 * keys so they stay statically extractable. DISPLAY only — the mechanism is precomputed
 * server-side under RLS; the view never re-derives access.
 */
const SHARE_MECHANISM_ORDER = ['personal', 'cohort', 'broadcast'] as const;

const SHARE_MECHANISM_META: Record<
  ShareMechanism,
  {
    icon: LucideIcon;
    label: (t: GraphTranslator) => string;
    hint: (t: GraphTranslator) => string;
  }
> = {
  personal: {
    icon: UserCheck,
    label: (t) => t('graph.drive.mechPersonal'),
    hint: (t) => t('graph.drive.mechPersonalHint'),
  },
  cohort: {
    icon: UsersRound,
    label: (t) => t('graph.drive.mechCohort'),
    hint: (t) => t('graph.drive.mechCohortHint'),
  },
  broadcast: {
    icon: Radio,
    label: (t) => t('graph.drive.mechBroadcast'),
    hint: (t) => t('graph.drive.mechBroadcastHint'),
  },
};

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
  onClearClipboard,
  onRestore,
  onPurge,
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
  const attributesByItem = kbData?.attributesByItem ?? {};
  // Memoized so the `?? {}` default is a STABLE reference — `metaByItem` feeds
  // `floorOf` (the broadcast badge) which is a `useCallback`/`useMemo` dependency;
  // a fresh `{}` each render would thrash those hooks (react-hooks/exhaustive-deps).
  const metaByItem = React.useMemo(() => kbData?.metaByItem ?? {}, [kbData]);
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

  // The access-mirror predicate (ADR-0023 §7a) — `granted(id)` = the owner authored a
  // DIRECT per-user grant on the node (`id ∈ sharedByMe`). The card badge marks a node
  // shown-as-shared IFF it OR a granted ANCESTOR folder is shared — `sharedOut` walks the
  // loaded `contains` forest for the nearest granted ancestor. This is the SAME source the
  // panel's Access summary reads, so badge ≡ panel ≡ access predicate (never divergent).
  // ALL browse scopes use it, not just 'shared-by-me' (a node shared via an ancestor must
  // badge wherever it is rendered). Pure display over the RLS-seeded `sharedByMe` + forest.
  const isGranted = React.useCallback(
    (id: string) => sharedByMeByResource.has(id),
    [sharedByMeByResource]
  );

  // The BROADCAST half of the access-mirror (ADR-0023 §7, the globe state) — `floorOf(id)`
  // = a node's broadcast floor from the already-loaded `metaByItem` (the node row's
  // `visibility`, Wave 2). `broadcastOut` walks the SAME `contains` forest as `sharedOut`
  // for the nearest broadcast-floor ANCESTOR, so a node under a space/org folder badges
  // GLOBE (floor inheritance). Pure display over the RLS-seeded node meta + forest; the
  // resolved default lens carries every folder, so every ancestor's floor is present.
  const floorOf = React.useCallback(
    (id: string): ResourceFloor | undefined => metaByItem[id]?.visibility,
    [metaByItem]
  );
  // The access STATUS of a node (ADR-0023 §7, owner browse): GLOBE (broadcast) outranks
  // PEOPLE (targeted) outranks NONE (private). One source for BOTH the grid card and the
  // list row, so they can never diverge — globe precedence applied HERE, once. Returns the
  // resolved `sharedOut`/`broadcastOut` verdicts so each badge can name its audience.
  const accessStatus = React.useCallback(
    (id: string) => {
      const broadcast = broadcastOut(containment, id, floorOf);
      const shared = sharedOut(containment, id, isGranted);
      const state: 'broadcast' | 'targeted' | 'private' = broadcast.isBroadcast
        ? 'broadcast'
        : shared.isShared
          ? 'targeted'
          : 'private';
      return { state, broadcast, shared } as const;
    },
    [containment, floorOf, isGranted]
  );
  // The per-card / per-row access STATUS badge (ADR-0023 §7a). KB is SPACE-FIRST: a
  // space-wide broadcast is the TYPICAL audience, so it shows NO badge — a clean card
  // reads as "shared with the space". Only the EXCEPTIONS are flagged: organization-wide
  // broadcast (wider, GLOBE), targeted PEOPLE, and PRIVATE (a freshly created node's
  // personal default — a LOCK, so an un-shared/personal resource stands out). One render
  // path for the grid + the list so the two surfaces are identical.
  const renderAccessBadge = React.useCallback(
    (id: string): React.ReactNode => {
      const { state, broadcast, shared } = accessStatus(id);
      if (state === 'broadcast') {
        // Space-wide broadcast = the typical KB default → no badge. Only org-wide flags.
        if (broadcast.scope === 'organization') {
          return (
            <BroadcastBadge
              t={t}
              scope="organization"
              broadcastViaTitle={broadcast.broadcastVia?.title ?? null}
            />
          );
        }
        return undefined;
      }
      if (state === 'targeted') {
        return (
          <SharedOutBadge
            t={t}
            direct={shared.direct}
            grantees={sharedByMeByResource.get(id) ?? []}
            inheritedFromTitle={shared.inheritedFrom?.title ?? null}
          />
        );
      }
      // private — personal, not shared (the default at creation); flag it with the lock.
      return <PrivateBadge t={t} />;
    },
    [accessStatus, sharedByMeByResource, t]
  );

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
    .sort(byTitle);
  const shortcuts =
    // Shortcuts are OFF in an advanced lens tree for v1 (Fork 3) — it is a containment
    // projection of the lens set, not the full Drive home.
    (
      isFilterScope || isRoot || isLensAdvanced
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
    .sort(isRecent ? byRecency : byTitle);

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
              .map((f) => buildTreeNode(f, new Set(ancestors).add(node.id))),
            ...childContent(treeContainment, node.id)
              .slice()
              .sort(byTitle)
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
            ...childFolders(treeContainment, node.id).map((f) =>
              folderRow(f, new Set(ancestors).add(node.id))
            ),
            ...childContent(treeContainment, node.id).map(itemRow),
          ]
        : undefined,
  });
  const driveRows: DriveRow[] = [
    ...folders.map((sub) => folderRow(sub, new Set<string>())),
    ...shortcuts.map((target) => ({
      id: `sc-${target.id}`,
      node: target,
      rowKind: 'shortcut' as const,
      onOpen: () =>
        target.kind === 'folder' ? navigate(target.id) : onSelect(target.id),
      onDetails: () => onSelect(target.id),
      actions: null,
    })),
    ...items.map(itemRow),
  ];

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
      onMutated={onMutated}
    />
  );

  const toolbar = (
    <div className="flex items-center gap-2.5 border-b px-5 py-3">
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
            className={cn(
              'shrink-0',
              isRoot && 'text-foreground font-semibold'
            )}
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
                    <span className="truncate font-semibold">
                      {crumb.title}
                    </span>
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
      <div className="ml-auto flex items-center gap-1.5">
        {/* Clipboard indicator (Dolphin model) — two states of the SAME affordance:
            • ACTIVE (canPaste: clipboard set AND this pane browses 'kb') → the full
              chip: a clickable Paste (source INTO this pane's current folder) + the ✕
              clear. The split-pane's payoff: Copy in A, navigate B, Paste here.
            • READ-ONLY (clipboard set but no paste target — a flat lens like Shared/
              Starred/Recent/Trash) → a muted "on your clipboard" hint: no Paste
              (nowhere to paste into here), but the ✕ clear IS present so the buffer
              can be cleared from ANY lens (not just by navigating back to KB / Escape).
              Escape still clears globally (the workbench keydown handler is
              scope-independent). */}
        {clipboard != null ? (
          canPaste ? (
            <div className="flex items-center overflow-hidden rounded-md border">
              <Hint
                label={t(
                  isRoot ? 'graph.drive.pasteRoot' : 'graph.drive.paste',
                  { title: clipboard.title }
                )}
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
                  <span className="max-w-[120px] truncate">
                    {clipboard.title}
                  </span>
                </Button>
              </Hint>
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
                  <span className="max-w-[120px] truncate">
                    {clipboard.title}
                  </span>
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
        ) : null}
        {/* Upload creates into the current location — meaningless in the Trash lens
            (a holding state for trashed nodes, not a place to author into). */}
        {!isTrash ? (
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
        ) : null}
        {/* The lens display-mode toggle (ADR-0022 Fork 4 + Addendum A): Flat ↔ Advanced,
            shown ONLY on a STRUCTURAL lens (Shared / Shared-by-me / Starred), NEVER on
            Recent/Home. When the space is NOT entitled it renders DISABLED, wrapped in a
            Hint with the upsell copy — NEVER hidden (the locked control IS the upsell,
            Fork 2). The server clamps `?view=` to 'flat' on a locked plan, so even a
            forged URL stays flat. */}
        {isStructuralLens && onLensViewChange ? (
          <LensViewToggle
            t={t}
            lensView={lensView}
            onLensViewChange={onLensViewChange}
            entitled={advancedStructuralEntitled}
          />
        ) : null}
        <LayoutToggle t={t} layout={layout} onLayoutChange={applyLayout} />
        {onToggleSplit && scope === 'kb' ? (
          <Hint
            label={t(
              split ? 'graph.drive.splitClose' : 'graph.drive.splitOpen'
            )}
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
        ) : null}
      </div>
    </div>
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
        currentUserId={currentUserId}
        layout={layout}
        selected={item.id === selectedId}
        sharedBadge={renderAccessBadge(item.id)}
        when={whenIso && mounted ? formatWhen(whenIso) : undefined}
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
      onRestore={onRestore}
      onPurge={onPurge}
    />
  );

  const main = (
    <>
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
                            subtitle={t('graph.drive.shortcutFolder')}
                            layout={layout}
                            shortcut
                            onOpen={() =>
                              target.kind === 'folder'
                                ? navigate(target.id)
                                : onSelect(target.id)
                            }
                            onDetails={() => onSelect(target.id)}
                            actions={
                              // A shortcut points ELSEWHERE, so "Open in KB" is meaningful even in
                              // the KB lens — it jumps to the target's CANONICAL home (target.id).
                              onRevealInKb ? (
                                <RevealInKbButton
                                  onReveal={() => onRevealInKb(target.id)}
                                  label={t('graph.panel.openInKb')}
                                />
                              ) : undefined
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
          {!isFilterScope &&
          isRoot &&
          folders.length === 0 &&
          items.length === 0 ? (
            <EmptyState>{t('graph.lens.emptyEditor')}</EmptyState>
          ) : null}
          {!isFilterScope &&
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

// ── cards (prototype FolderCard / ItemCard) ───────────────────────────────

// Grid = flex-wrap of FIXED-width cards (NOT a `1fr` grid): card width must stay
// constant whether the Details panel is open or closed — `1fr`/`minmax` would
// restretch every card when the available width changes, so the icons/tiles
// visibly jump. With a fixed basis (`shrink-0` so two-up rows never squeeze), a
// width change only reflows the column COUNT (pure flex), never the card size —
// and EVERY kind (folder, document, file) shares this one width, so they line up.
// Cards left-align; trailing space is fine. Width is generous so longer titles
// stay readable before they truncate.
function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const GRID_CARD = 'w-[264px] shrink-0';
const GRID_WRAP = 'flex flex-wrap gap-2.5';
const LIST_WRAP = 'flex flex-col gap-1.5';

/**
 * The per-node star toggle (the only per-user write the Drive surface owns today).
 * On a card it reveals on hover when unstarred — like the ⋯ menu — and stays solid
 * amber once starred so the Starred set reads at a glance; `alwaysShow` keeps it
 * visible inside the table rows, which carry no hover-reveal group.
 */
function StarButton({
  starred,
  onToggle,
  label,
  alwaysShow,
}: {
  starred: boolean;
  onToggle: () => void;
  label: string;
  alwaysShow?: boolean;
}) {
  // Thin domain wrapper over the shared RowActionButton (single source of truth for the
  // row-action style). `active`/`alwaysShow` force the button visible; otherwise it
  // hover-reveals like the ⋯ menu. The amber fill (when starred) lives on the icon — the
  // shared button governs chrome + reveal, not the star's domain treatment. Note the hover
  // is now the STRONG one (darker fill + foreground), matching the other row actions.
  return (
    <RowActionButton
      label={label}
      aria-pressed={starred}
      onActivate={onToggle}
      reveal={alwaysShow ? 'always' : 'hover'}
      active={starred}
      hint={false}
    >
      <Star
        className={cn(
          'size-4',
          starred ? 'fill-amber-400 text-amber-400' : undefined
        )}
        aria-hidden
      />
    </RowActionButton>
  );
}

/**
 * RevealInKbButton — a small inline action that sits next to the star and jumps to this
 * resource's position in the KB containment tree (the 'kb' lens at its parent folder).
 * Hover-revealed like the other card actions; the same affordance lives in the `⋯` menu
 * ("Open in KB") for surfaces without a star. A thin domain wrapper over the shared
 * RowActionButton (the same `Target` "open in KB" jump the search lens's OpenInKbButton is).
 */
function RevealInKbButton({
  onReveal,
  label,
}: {
  onReveal: () => void;
  label: string;
}) {
  return (
    <RowActionButton
      label={label}
      onActivate={onReveal}
      reveal="hover"
      hint={false}
    >
      <Target className="size-4" aria-hidden />
    </RowActionButton>
  );
}

/**
 * CardActionRail — the per-card "command" controls (star + `⋯` menu + reveal-in-KB), unified
 * across EVERY card lens. INVARIANT: the STAR sits at the FAR CORNER in either orientation —
 * the TOP of the vertical rail (grid, = top-right corner) and the RIGHTMOST of the horizontal
 * rail (list rows, via `flex-row-reverse`). Grid = vertical (~1 button wide, keeps the title
 * width); list rows = horizontal + vertically centered so the rail fits the short row.
 */
function CardActionRail({
  star,
  actions,
  list = false,
}: {
  star?: React.ReactNode;
  actions?: React.ReactNode;
  list?: boolean;
}) {
  if (!star && !actions) {
    return null;
  }
  return (
    <div
      className={
        list
          ? 'absolute inset-y-0 right-2 flex flex-row-reverse items-center gap-0.5'
          : 'absolute top-2 right-2 flex flex-col items-end gap-0.5'
      }
    >
      {star}
      {actions}
    </div>
  );
}

/**
 * GranteeSummary — the "who I shared this with" line on a "Shared by me" card
 * (ADR-0021 Part B). A compact avatar cluster + a label: "Shared with {name}" for
 * one grantee, "Shared with {name} +{n}" for a few, or "Shared with {n} people" once
 * the cluster would overflow. Each avatar carries a Hint tooltip with the person's
 * name + email (the same EntityAvatar + Hint pattern the Share dialog uses for the
 * per-person grant rows). Grantees arrive pre-sorted by display name from the data
 * layer (don't re-sort).
 */
const GRANTEE_AVATAR_CAP = 3;

function GranteeSummary({
  t,
  grantees,
}: {
  t: GraphTranslator;
  grantees: SharedByMeEntry['grantees'];
}) {
  if (grantees.length === 0) {
    return null;
  }
  const shown = grantees.slice(0, GRANTEE_AVATAR_CAP);
  const overflow = grantees.length - shown.length;
  // One → name the person; a few → name the first + "+n"; many → just the count.
  const label =
    grantees.length === 1
      ? t('graph.drive.sharedWithOne', { name: grantees[0]!.displayName })
      : grantees.length <= GRANTEE_AVATAR_CAP
        ? t('graph.drive.sharedWithMany', {
            name: grantees[0]!.displayName,
            count: grantees.length - 1,
          })
        : t('graph.drive.sharedWithCount', { count: grantees.length });
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex -space-x-1.5">
        {shown.map((g) => (
          <Hint key={g.userId} label={g.email ?? g.displayName}>
            <span className="inline-flex">
              <EntityAvatar
                name={g.displayName}
                className="ring-card size-5 ring-2"
                fallbackClassName="text-[9px]"
              />
            </span>
          </Hint>
        ))}
        {overflow > 0 ? (
          <span className="bg-muted text-muted-foreground ring-card grid size-5 place-items-center rounded-full text-[9px] font-semibold ring-2">
            +{overflow}
          </span>
        ) : null}
      </div>
      <span className="text-muted-foreground truncate text-xs">{label}</span>
    </div>
  );
}

/**
 * SharedOutBadge — the per-card "this is shared out" people-icon badge (ADR-0023 §7a,
 * Tier 1). It marks a node shown-as-shared per the access-mirror invariant: the node OR
 * a granted ancestor folder is shared (computed by `sharedOut` over the loaded forest).
 * It renders in ALL browse scopes (not only 'shared-by-me') so a node shared via an
 * ancestor badges wherever it appears. The Hint names the audience: the grantee count/
 * names for a direct grant, or "Shared via {folder}" when access is purely inherited —
 * so the badge can never silently imply a node is shared without saying by whom. Pure
 * DISPLAY mirror of the already-resolved `sharedByMe` + forest; never a fence.
 */
function SharedOutBadge({
  t,
  direct,
  grantees,
  inheritedFromTitle,
}: {
  t: GraphTranslator;
  /** The node carries its OWN direct grant (vs purely inherited from an ancestor). */
  direct: boolean;
  /** Grantees of the DIRECT grant (empty when access is purely inherited). */
  grantees: SharedByMeEntry['grantees'];
  /** Title of the nearest granted ancestor when access is (also) inherited. */
  inheritedFromTitle: string | null;
}) {
  // The tooltip names WHO can read it: the direct grantees (count/names) when granted
  // directly, else the inheriting folder. A direct grant takes precedence in the copy.
  const label =
    direct && grantees.length > 0
      ? grantees.length === 1
        ? t('graph.drive.sharedWithOne', { name: grantees[0]!.displayName })
        : grantees.length <= GRANTEE_AVATAR_CAP
          ? t('graph.drive.sharedWithMany', {
              name: grantees[0]!.displayName,
              count: grantees.length - 1,
            })
          : t('graph.drive.sharedWithCount', { count: grantees.length })
      : inheritedFromTitle != null
        ? t('graph.drive.sharedOutInherited', { folder: inheritedFromTitle })
        : t('graph.drive.sharedOutBadge');
  return (
    <AccessBadgeChip label={label}>
      <Users className="size-3" aria-hidden />
    </AccessBadgeChip>
  );
}

/**
 * AccessBadgeChip — the shared round icon-chip shell for the access-status badges
 * (ADR-0023 §7a): the people-icon `SharedOutBadge` and the globe `BroadcastBadge` are the
 * SAME `size-5` muted round chip wrapped in a `Hint`, differing only in the icon + the
 * tooltip copy. Lifting the shell keeps the two badges pixel-identical and gives the
 * globe-XOR-people taxonomy one visual vocabulary (ui-primitive-hygiene). The Hint label
 * doubles as the `aria-label`, so the badge always names its audience (never a silent mark).
 */
function AccessBadgeChip({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Hint label={label}>
      <span
        aria-label={label}
        className="text-muted-foreground bg-muted grid size-5 shrink-0 place-items-center rounded-full"
      >
        {children}
      </span>
    </Hint>
  );
}

/**
 * BroadcastBadge — the per-card GLOBE badge (ADR-0023 §7a, the broadcast state): the node's
 * EFFECTIVE floor is `space`/`organization`, either its OWN `visibility` or — via floor
 * inheritance — an owner-scoped ancestor folder on a broadcast floor (`broadcastOut`). It
 * OUTRANKS the people badge (a broadcast node is "for everyone in the scope", the widest
 * audience). The Hint NAMES the scope ("Visible to everyone in {Space|Organization}") and,
 * when inherited, the broadcasting folder — so the globe can never silently imply a blast
 * radius. Pure DISPLAY mirror of the RLS-seeded node `visibility` + forest; never a fence.
 */
function BroadcastBadge({
  t,
  scope,
  broadcastViaTitle,
}: {
  t: GraphTranslator;
  /** The broadcast scope — the node's own floor, else the inheriting folder's. */
  scope: 'space' | 'organization';
  /** Title of the broadcasting ANCESTOR folder when broadcast is inherited, else null. */
  broadcastViaTitle: string | null;
}) {
  const scopeLabel =
    scope === 'organization'
      ? t('graph.drive.broadcastScopeOrganization')
      : t('graph.drive.broadcastScopeSpace');
  // Inherited → name BOTH the scope and the broadcasting folder; own floor → the scope only.
  const label =
    broadcastViaTitle != null
      ? t('graph.drive.broadcastViaFolder', {
          scope: scopeLabel,
          folder: broadcastViaTitle,
        })
      : t('graph.drive.broadcastBadge', { scope: scopeLabel });
  return (
    <AccessBadgeChip label={label}>
      <Globe className="size-3" aria-hidden />
    </AccessBadgeChip>
  );
}

/**
 * PrivateBadge — flags a PRIVATE (personal, not-shared) node. KB inverts the default: the
 * space-wide broadcast (the common case) is badge-less, so the EXCEPTION worth surfacing is
 * the still-personal resource — a freshly created node is private by default (ADR-0017), and
 * the lock makes "this is yours only, not yet shared with the space" legible at a glance.
 */
function PrivateBadge({ t }: { t: GraphTranslator }) {
  return (
    <AccessBadgeChip label={t('graph.drive.privateBadge')}>
      <Lock className="size-3" aria-hidden />
    </AccessBadgeChip>
  );
}

/**
 * SharedFolderHint — the load-bearing "placement = sharing" warning on a folder that
 * confers access (ADR-0023 §5 + §7a). Because there is NO subtractive detach, dropping
 * a node into a shared folder auto-shares it; for a `space`/`organization`-FLOOR folder
 * that is an AUTO-BROADCAST to everyone in the scope. The copy MUST name the actual
 * audience — and for a floor folder the SCOPE explicitly — never collapse a floor into a
 * generic "shared with N people" (the only guardrail against an accidental broadcast).
 * Precedence: a broadcast floor (the widest blast radius) is named even when the folder
 * ALSO has per-person grants. Pure display over the node's `visibility` + `sharedByMe`.
 */
function SharedFolderHint({
  t,
  visibility,
  grantees,
}: {
  t: GraphTranslator;
  visibility: ResourceFloor | undefined;
  grantees: SharedByMeEntry['grantees'];
}) {
  const text =
    visibility === 'organization'
      ? t('graph.drive.sharedFolderHintOrganization')
      : visibility === 'space'
        ? t('graph.drive.sharedFolderHintSpace')
        : grantees.length === 1
          ? t('graph.drive.sharedFolderHintPeople', {
              name: grantees[0]!.displayName,
            })
          : grantees.length > 1
            ? t('graph.drive.sharedFolderHintPeopleCount', {
                count: grantees.length,
              })
            : null;
  if (text == null) {
    return null;
  }
  return (
    <div className="text-muted-foreground mt-1 flex items-start gap-1.5 text-[11px]">
      <Info className="mt-px size-3 shrink-0" aria-hidden />
      {/* Clamp so an unusually long hint can never inflate the fixed-height tile. */}
      <span className="line-clamp-2">{text}</span>
    </div>
  );
}

/**
 * ShareMechanismBadge — the per-card "why is this shared with me" badge in the
 * 'shared' (incoming) lens ONLY (ADR-0021 Part C). A compact shadcn `Badge` (the same
 * chip primitive the cards already use) + a small lucide icon + the mechanism label,
 * wrapped in a `Hint` that explains the mechanism (the label alone is terse). The
 * mechanism is the precomputed WINNING one (personal > cohort > broadcast) — DISPLAY
 * over an already-resolved, already-fenced set, never a recomputed access decision.
 */
function ShareMechanismBadge({
  t,
  mechanism,
}: {
  t: GraphTranslator;
  mechanism: ShareMechanism;
}) {
  const meta = SHARE_MECHANISM_META[mechanism];
  const Icon = meta.icon;
  const label = meta.label(t);
  return (
    <Hint label={meta.hint(t)}>
      <Badge
        variant="secondary"
        className="gap-1 font-normal"
        aria-label={label}
      >
        <Icon className="size-3" aria-hidden />
        <span className="truncate">{label}</span>
      </Badge>
    </Hint>
  );
}

/**
 * ShareFacetChips — the facet/chip row above the 'shared' lens (ADR-0021 Part C). One
 * "All" chip + one chip per mechanism PRESENT in the shared set (absent mechanisms are
 * never shown). Clicking a mechanism narrows the rendered shared nodes to it; "All"
 * clears the filter. A client display filter over the precomputed annotation — facet
 * state is local to the lens and resets on leaving it. Built from the `Button` toggle
 * pattern the toolbar already uses (`aria-pressed`, rounded chips, accent-on-active),
 * NOT a new primitive (shadcn-patterns-required).
 */
function ShareFacetChips({
  t,
  mechanisms,
  active,
  onChange,
}: {
  t: GraphTranslator;
  mechanisms: readonly ShareMechanism[];
  active: ShareMechanism | null;
  onChange: (next: ShareMechanism | null) => void;
}) {
  const chip = (
    key: string,
    selected: boolean,
    label: string,
    onClick: () => void,
    icon?: LucideIcon
  ) => {
    const Icon = icon;
    return (
      <Button
        key={key}
        type="button"
        variant="ghost"
        size="pill"
        onClick={onClick}
        aria-pressed={selected}
        className={cn(
          'border',
          selected
            ? 'bg-accent text-foreground border-transparent'
            : 'text-muted-foreground border-border hover:bg-accent hover:text-foreground'
        )}
      >
        {Icon ? <Icon className="size-3" aria-hidden /> : null}
        {label}
      </Button>
    );
  };
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {chip('all', active == null, t('graph.drive.facetAll'), () =>
        onChange(null)
      )}
      {mechanisms.map((mech) =>
        chip(
          mech,
          active === mech,
          SHARE_MECHANISM_META[mech].label(t),
          () => onChange(mech),
          SHARE_MECHANISM_META[mech].icon
        )
      )}
    </div>
  );
}

/** Drag/drop wiring a card applies to its outer wrapper (the workbench owns the
 * DndContext; the cards just mark themselves draggable / droppable). */
type CardDnd = {
  /** Combined draggable+droppable ref + listeners/attributes for the wrapper. */
  setRef?: (el: HTMLElement | null) => void;
  listeners?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  /** This card is the source being dragged (dim it). */
  dragging?: boolean;
  /** A valid drag is hovering this folder (highlight as the active drop target). */
  dropOver?: boolean;
  /** A drag is in progress and this folder is a VALID landing zone — show a quiet
   * "you can drop here" affordance (distinct from the stronger `dropOver` hover). */
  candidate?: boolean;
};

function FolderCard({
  title,
  subtitle,
  layout,
  shortcut,
  onOpen,
  onDetails,
  star,
  actions,
  footer,
  sharedBadge,
  folderHint,
  dnd,
}: {
  title: string;
  subtitle: string;
  layout: DriveLayout;
  shortcut?: boolean;
  /** Double-click / Open: navigate into the folder (or follow the shortcut). */
  onOpen: () => void;
  /** Single-click: open the shared Details panel for this node. */
  onDetails: () => void;
  /** Per-folder star toggle. Omitted for shortcut cards (a symlink, not a node). */
  star?: React.ReactNode;
  /** Hover `⋯` action menu for THIS folder. Folders navigate on click, so actions
   * need a separate affordance — a deliberate delta from the prototype (which
   * navigated folders with no action surface). Omitted for shortcut cards. */
  actions?: React.ReactNode;
  /** Extra line under the subtitle (the "Shared by me" grantee summary). */
  footer?: React.ReactNode;
  /** The access-mirror people-icon badge, shown when the folder is shared out
   * (ADR-0023 §7a) — direct OR via a granted ancestor. Inline beside the title. */
  sharedBadge?: React.ReactNode;
  /** The "placement = sharing" hint on a folder that confers access (ADR-0023 §7a) —
   * names the audience / floor scope. Rendered under the subtitle. */
  folderHint?: React.ReactNode;
  /** Drag (this folder can be moved) + drop (other nodes re-parent into it). */
  dnd?: CardDnd;
}) {
  const list = layout === 'list';
  const open = useCardOpen(onDetails, onOpen);
  return (
    <div
      ref={dnd?.setRef}
      {...(dnd?.attributes ?? {})}
      {...(dnd?.listeners ?? {})}
      className={cn(
        'group relative select-none',
        list ? 'w-full' : GRID_CARD,
        dnd?.dragging && 'opacity-40',
        dnd?.candidate &&
          !dnd?.dropOver &&
          'outline-ring/40 rounded-lg outline-1 outline-offset-1 outline-dashed',
        dnd?.dropOver && 'outline-ring rounded-lg outline-2 outline-offset-1'
      )}
    >
      <CardTile
        {...open}
        className={cn(
          'w-full',
          // INVARIANT: a FIXED, uniform grid-card height across EVERY lens (never grow-to-
          // content, which drifts row-to-row) — sized to fit a 2-line title + meta + a
          // footer/hint and the vertical action rail. List rows keep their own height.
          list
            ? 'gap-3 px-3.5 py-2.5'
            : 'h-44 items-start gap-2.5 overflow-hidden p-4'
        )}
      >
        {shortcut ? (
          <FolderSymlink
            className={cn(
              'text-muted-foreground',
              list ? 'size-[18px]' : 'size-[22px]'
            )}
            aria-hidden
          />
        ) : (
          <Folder
            className={cn(
              'text-muted-foreground',
              list ? 'size-[18px]' : 'size-[22px]'
            )}
            aria-hidden
          />
        )}
        <div className="min-w-0 flex-1 text-left">
          <div
            className={cn(
              'text-sm font-medium',
              list ? 'truncate' : 'line-clamp-2 pr-9'
            )}
          >
            {title}
          </div>
          <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
            <span className="truncate">{subtitle}</span>
            {sharedBadge}
          </div>
          {folderHint}
          {footer ? <div className="mt-1.5">{footer}</div> : null}
        </div>
        {shortcut ? (
          <ArrowUpRight
            className="text-muted-foreground size-3.5"
            aria-hidden
          />
        ) : null}
      </CardTile>
      <CardActionRail star={star} actions={actions} list={list} />
    </div>
  );
}

export function ItemCard({
  t,
  node,
  attributes,
  meta,
  currentUserId,
  layout,
  selected,
  onOpen,
  onDetails,
  star,
  actions,
  footer,
  sharedBadge,
  when,
  dnd,
}: {
  t: GraphTranslator;
  node: LensNode;
  attributes?: KbAttributes;
  meta?: NodeMeta;
  currentUserId: string | null;
  layout: DriveLayout;
  selected: boolean;
  /** Double-click / Open: a document opens its read-view (other kinds: Details). */
  onOpen: () => void;
  /** Single-click: open the shared Details panel for this node. */
  onDetails: () => void;
  /** Per-node star toggle (reveals on hover; solid amber once starred). */
  star?: React.ReactNode;
  /** Hover `⋯` action menu for this node (Details opens the panel). */
  actions?: React.ReactNode;
  /** Extra line under the meta line (the "Shared by me" grantee summary). */
  footer?: React.ReactNode;
  /** The access-mirror people-icon badge, shown when the node is shared out (ADR-0023
   * §7a) — direct OR via a granted ancestor. Rendered inline beside the title. */
  sharedBadge?: React.ReactNode;
  /** The "For you" sort timestamp, appended to the meta line (opened / updated time). */
  when?: string;
  /** Drag wiring (a content card is draggable, but not a drop target). */
  dnd?: CardDnd;
}) {
  const list = layout === 'list';
  const open = useCardOpen(onDetails, onOpen);

  // Meta line (prototype `n.meta || meta.label · owner`): link host / file size /
  // video duration from the REAL `kb` satellites (`resource_media_meta` /
  // `resource_link`). When a satellite row is absent the value is simply null and
  // the line falls back to "{kind} · {owner}" — no mock fill (poc-no-fallbacks).
  const media = {
    byteSize: attributes?.media?.byteSize ?? null,
    durationMs: attributes?.media?.durationMs ?? null,
    mimeType: attributes?.media?.mimeType ?? null,
    linkHost: attributes?.link?.host ?? null,
  };
  const mediaMeta = formatNodeMeta(t, node.kind, media);
  const metaLine =
    mediaMeta ??
    t('graph.drive.metaOwner', {
      kind: kindLabel(t, node.kind),
      owner: ownerLabel(t, meta?.ownerUserId, currentUserId),
    });

  return (
    <div
      ref={dnd?.setRef}
      {...(dnd?.attributes ?? {})}
      {...(dnd?.listeners ?? {})}
      className={cn(
        'group relative select-none',
        list ? 'w-full' : GRID_CARD,
        dnd?.dragging && 'opacity-40'
      )}
    >
      <CardTile
        {...open}
        data-selected={selected}
        className={cn(
          'w-full',
          list
            ? 'gap-3 px-3.5 py-2.5'
            : 'h-44 items-start gap-2.5 overflow-hidden p-4',
          selected ? 'border-ring ring-ring/35 ring-[3px]' : ''
        )}
      >
        {React.createElement(iconForKind(node.kind), {
          className: cn(
            'text-muted-foreground',
            list ? 'size-[18px]' : 'size-[22px]'
          ),
          'aria-hidden': true,
        })}
        <div className="min-w-0 flex-1 text-left">
          <div
            className={cn(
              'text-sm font-medium',
              list ? 'truncate' : 'line-clamp-4 pr-9'
            )}
          >
            {node.title}
          </div>
          <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
            <span className="truncate">
              {when ? kindLabel(t, node.kind) : metaLine}
            </span>
            {when ? <span className="shrink-0">· {when}</span> : null}
            {sharedBadge}
          </div>
          {footer ? <div className="mt-1.5">{footer}</div> : null}
        </div>
      </CardTile>
      <CardActionRail star={star} actions={actions} list={list} />
    </div>
  );
}

/**
 * TrashCard — one trashed node in the Trash lens (ADR-0018 §10.7). It is NOT a
 * browsable card: a trashed node has no open / navigate / star / ⋯ menu — only the
 * two lifecycle verbs reached from inside Trash, Restore and Purge.
 *
 * - Restore (`PATCH /author/graph/trash`) clears `deleted_at`; references re-admit
 *   automatically (dormant edges). Owner-sovereign / `delete`-verb gated in the DB.
 * - Purge (`DELETE /author/graph/trash`) is the one-way door — it ALWAYS confirms
 *   first, and when the in-use guard rejects it (living cross-owner references) the
 *   confirm switches to the cooperative "in use" message instead of destroying. The
 *   guard rejection is surfaced gracefully (never thrown).
 */
function TrashCard({
  t,
  node,
  meta,
  currentUserId,
  layout,
  onRestore,
  onPurge,
}: {
  t: GraphTranslator;
  node: LensNode;
  meta?: NodeMeta;
  currentUserId: string | null;
  layout: DriveLayout;
  onRestore?: (nodeId: string) => Promise<boolean>;
  onPurge?: (nodeId: string) => Promise<'purged' | 'in-use' | 'error'>;
}) {
  const list = layout === 'list';
  const [busy, setBusy] = React.useState(false);
  const [confirmPurge, setConfirmPurge] = React.useState(false);
  // When the in-use guard rejects a purge, the confirm dialog stays open and shows the
  // cooperative "in use" message instead of the destructive prompt (nothing destroyed).
  const [inUse, setInUse] = React.useState(false);

  const metaLine = t('graph.drive.metaOwner', {
    kind: kindLabel(t, node.kind),
    owner: ownerLabel(t, meta?.ownerUserId, currentUserId),
  });

  const handleRestore = async () => {
    if (!onRestore) {
      return;
    }
    setBusy(true);
    await onRestore(node.id);
    // Success re-resolves (the row leaves Trash); a no-op (unauthorized) just clears
    // busy. Either way no throw.
    setBusy(false);
  };

  const handlePurge = async () => {
    if (!onPurge) {
      return;
    }
    setBusy(true);
    const outcome = await onPurge(node.id);
    setBusy(false);
    if (outcome === 'in-use') {
      // Cooperative rejection — keep the dialog open, swap to the in-use message.
      setInUse(true);
      return;
    }
    // 'purged' re-resolves (row gone); 'error' is a clean no-op — close either way.
    setConfirmPurge(false);
  };

  return (
    <>
      {/* A trashed node is NOT clickable (no open/navigate) — so this is a plain
          surface DIV, not the clickable CardTile (which is a <button> and would
          nest the Restore/Purge buttons). Same card tokens, no hover-to-ring.

          List = one horizontal row [icon][title flex-1][actions]. Grid is a fixed
          264px card: the two TEXT actions + icon would squeeze the flex-1 title to
          ~zero and hide it, so grid STACKS — [icon + title] on top, the actions on
          their own justify-end row beneath — keeping the title fully readable. */}
      <div
        className={cn(
          'bg-card flex border shadow-xs',
          'rounded-lg',
          list
            ? 'w-full items-center gap-3 px-3.5 py-2.5'
            : cn(GRID_CARD, 'flex-col gap-2.5 p-4')
        )}
      >
        <div
          className={cn(
            'flex min-w-0 items-center',
            list ? 'flex-1 gap-3' : 'w-full gap-2.5'
          )}
        >
          {React.createElement(iconForKind(node.kind), {
            className: cn(
              'text-muted-foreground shrink-0',
              list ? 'size-[18px]' : 'size-[22px]'
            ),
            'aria-hidden': true,
          })}
          <div className="min-w-0 flex-1 text-left">
            <div className="truncate text-sm font-medium">{node.title}</div>
            <div className="text-muted-foreground truncate text-xs">
              {metaLine}
            </div>
          </div>
        </div>
        <div
          className={cn(
            'flex shrink-0 items-center gap-1',
            list ? '' : 'justify-end'
          )}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRestore}
            disabled={busy || !onRestore}
          >
            <RotateCcw className="size-4" aria-hidden />
            {t('graph.trash.restore')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setInUse(false);
              setConfirmPurge(true);
            }}
            disabled={busy || !onPurge}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="size-4" aria-hidden />
            {t('graph.trash.purge')}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmPurge}
        onOpenChange={(open) => {
          setConfirmPurge(open);
          if (!open) {
            setInUse(false);
          }
        }}
        title={t('graph.trash.purge')}
        description={
          inUse
            ? t('graph.trash.inUse', { title: node.title })
            : t('graph.trash.purgeConfirm', { title: node.title })
        }
        confirmLabel={t('graph.trash.purge')}
        cancelLabel={t('graph.panel.cancel')}
        onConfirm={handlePurge}
        busy={busy}
        destructive
        confirmIcon={<Trash2 className="size-4" aria-hidden />}
      />
    </>
  );
}

function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'text-muted-foreground mb-2 text-xs font-semibold tracking-[0.04em] uppercase',
        className
      )}
    >
      {children}
    </div>
  );
}

// ── drag & drop card wrappers ─────────────────────────────────────────────
// `useDraggable`/`useDroppable` are hooks, so they can't run inside a `.map()`;
// these one-per-card wrapper components call them and hand the wiring to the card.
// The workbench owns the DndContext + the move/copy mutation; these only mark a card
// as a drag source / drop target. A stable drag id lets the overlay/collision work.

/** Merge dnd-kit's draggable + droppable refs onto one element (folders are both). */
function useMergedRef(
  a?: (el: HTMLElement | null) => void,
  b?: (el: HTMLElement | null) => void
) {
  return React.useCallback(
    (el: HTMLElement | null) => {
      a?.(el);
      b?.(el);
    },
    [a, b]
  );
}

/** A content card (file/doc/video) — a drag SOURCE only (not a drop target). */
function DraggableItemCard(
  props: React.ComponentProps<typeof ItemCard> & { dragData: DriveDragData }
) {
  const { dragData, ...rest } = props;
  const paneId = usePaneId();
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `${paneId}:node-${dragData.nodeId}`,
    data: dragData,
  });
  return (
    <ItemCard
      {...rest}
      dnd={{
        setRef: setNodeRef,
        listeners: listeners as Record<string, unknown> | undefined,
        attributes: attributes as unknown as Record<string, unknown>,
        dragging: isDragging,
      }}
    />
  );
}

/** A folder card — a drag SOURCE and a drop TARGET (other nodes re-parent into it). */
function DraggableDroppableFolderCard(
  props: React.ComponentProps<typeof FolderCard> & { dragData: DriveDragData }
) {
  const { dragData, ...rest } = props;
  const paneId = usePaneId();
  const dragState = useDriveDragState();
  const drag = useDraggable({
    id: `${paneId}:node-${dragData.nodeId}`,
    data: dragData,
  });
  const drop = useDroppable({
    id: `${paneId}:folder-${dragData.nodeId}`,
    data: { type: 'folder', folderId: dragData.nodeId } satisfies DriveDropData,
  });
  const setRef = useMergedRef(drag.setNodeRef, drop.setNodeRef);
  // Don't highlight a folder being dragged onto itself (compare the active drag's
  // node id, not the DOM element — the ids carry different prefixes).
  const activeNodeId = (drop.active?.data.current as DriveDragData | undefined)
    ?.nodeId;
  const dropOver = drop.isOver && activeNodeId !== dragData.nodeId;
  // A valid landing zone for the live drag (any folder except this drag's source /
  // its own subtree) — lit up the moment the drag starts.
  const candidate =
    !!dragState &&
    !dragState.isInvalidTarget(dragData.nodeId) &&
    !drag.isDragging;
  return (
    <FolderCard
      {...rest}
      dnd={{
        setRef,
        listeners: drag.listeners as Record<string, unknown> | undefined,
        attributes: drag.attributes as unknown as Record<string, unknown>,
        dragging: drag.isDragging,
        dropOver: dropOver && !drag.isDragging,
        candidate,
      }}
    />
  );
}

/** The breadcrumb "top level" drop zone — dropping here re-parents to the root. */
function RootDropZone({
  children,
}: {
  children: (over: boolean) => React.ReactNode;
}) {
  const paneId = usePaneId();
  const { setNodeRef, isOver } = useDroppable({
    id: `${paneId}:drop-root-crumb`,
    data: { type: 'root' } satisfies DriveDropData,
  });
  return <span ref={setNodeRef}>{children(isOver)}</span>;
}

/**
 * The CANVAS drop zone — wraps the whole content area so a drop on the EMPTY space
 * below the items (not on a folder) re-parents into the folder THIS PANE is currently
 * viewing (the Dolphin/Finder model: dropping in the open folder lands in it; the
 * breadcrumb is for going up). At the root that means the top level — so this also
 * serves the "drop on empty space → root" case. Fills the pane height (`min-h-full`)
 * so the empty area is catchable; lights up dashed while a drag is active and solid on
 * hover. The custom `driveCollision` keeps folders winning when the pointer is on them.
 */
function CanvasRootDropZone({
  folderId,
  children,
}: {
  folderId: string | null;
  children: React.ReactNode;
}) {
  const paneId = usePaneId();
  const dragState = useDriveDragState();
  // Dropping into the folder we're viewing is invalid only when THAT folder is the
  // active node itself or its descendant (can't re-parent into your own subtree).
  const invalid =
    !!folderId && !!dragState && dragState.isInvalidTarget(folderId);
  const { setNodeRef, isOver } = useDroppable({
    id: `${paneId}:drop-canvas`,
    disabled: invalid,
    data: (folderId
      ? { type: 'folder', folderId }
      : { type: 'root' }) satisfies DriveDropData,
  });
  const active = !!dragState && !invalid;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'min-h-full rounded-lg',
        active &&
          'outline-ring/30 outline-1 -outline-offset-2 transition-colors outline-dashed',
        isOver && 'bg-accent/40 outline-ring/70'
      )}
    >
      {children}
    </div>
  );
}

/**
 * Per-row drag/drop wiring for the LIST/TREE table. Runs INSIDE each table row's own
 * component (`DataTableRow`), so the dnd hooks here are rules-of-hooks safe. A
 * content/folder ROW is a drag source; a FOLDER row is also a drop target (re-parent
 * into it). Shortcut rows (symlinks, not nodes) are inert. The returned `rowProps`
 * (ref + listeners + draggable attrs) and `isDropTarget` flag are spread by the table.
 */
function useDriveRowDnd(row: DriveRow): {
  rowProps?: React.HTMLAttributes<HTMLTableRowElement> & {
    ref?: React.Ref<HTMLTableRowElement>;
  };
  isDropTarget?: boolean;
  isCandidate?: boolean;
} | void {
  const paneId = usePaneId();
  const dragState = useDriveDragState();
  const draggable = row.rowKind !== 'shortcut';
  const isFolder = row.rowKind === 'folder';
  const drag = useDraggable({
    id: `${paneId}:row-node-${row.id}`,
    disabled: !draggable,
    data: {
      type: 'node',
      nodeId: row.node.id,
      title: row.node.title,
      kind: row.node.kind,
    } satisfies DriveDragData,
  });
  const drop = useDroppable({
    id: `${paneId}:row-folder-${row.id}`,
    disabled: !isFolder,
    data: { type: 'folder', folderId: row.node.id } satisfies DriveDropData,
  });
  if (row.rowKind === 'shortcut') {
    return undefined;
  }
  const setRef = (el: HTMLTableRowElement | null) => {
    drag.setNodeRef(el);
    if (isFolder) {
      drop.setNodeRef(el);
    }
  };
  const activeNodeId = (drop.active?.data.current as DriveDragData | undefined)
    ?.nodeId;
  const dropOver = isFolder && drop.isOver && activeNodeId !== row.node.id;
  const candidate =
    isFolder &&
    !!dragState &&
    !dragState.isInvalidTarget(row.node.id) &&
    !drag.isDragging;
  return {
    rowProps: {
      ref: setRef,
      ...(drag.attributes as unknown as React.HTMLAttributes<HTMLTableRowElement>),
      ...(drag.listeners as unknown as React.HTMLAttributes<HTMLTableRowElement>),
      className: cn(drag.isDragging && 'opacity-40'),
    },
    isDropTarget: dropOver && !drag.isDragging,
    isCandidate: candidate,
  };
}

// ── list view (table) ─────────────────────────────────────────────────────

/** One Drive row for the table view — a folder, a shortcut, or a content item. */
export type DriveRow = {
  id: string;
  node: LensNode;
  rowKind: 'folder' | 'shortcut' | 'item';
  /** Double-click / Enter: navigate in / open the reader. */
  onOpen: () => void;
  /** Single click: open the shared Details panel. */
  onDetails: () => void;
  /** Hover `⋯` actions (folders/items); shortcuts have none. */
  actions: React.ReactNode | null;
  /** Tree mode (browse): a folder's children (folders then content), recursively.
   * Undefined in flat lenses → the table renders flat. */
  subRows?: DriveRow[];
};

/**
 * LensListTable — the parameterizable LIST layout (ADR-0025): a node-set rendered as a
 * sortable table (the generic {@link DataTable}) instead of cards, with every
 * cross-cutting column assembled from optional flags/slots so EVERY lens — KB browse,
 * the flat filter lenses, and (Phase B) the lexical-search list/tree — renders through
 * the ONE table. Row interaction matches the cards (single → Details, double → open).
 * Columns are domain/i18n here; the generic table base lives in `@workspace/ui`.
 *
 * Optional slots default OFF/identity so the existing Drive call site is byte-identical:
 * `snippet` adds a trailing matched-excerpt column (only search supplies it), and
 * `expansion: 'always'` renders the tree fully-unfolded with no collapse (search's
 * advanced view) instead of the collapsible browse tree.
 */
export function LensListTable({
  rows,
  t,
  metaByItem,
  currentUserId,
  selectedId,
  starredSet,
  onToggleStar,
  recentOpenedAt,
  defaultSorting,
  tree = false,
  expansion = 'collapsible',
  dndEnabled = false,
  sharedBadgeFor,
  snippet,
}: {
  rows: DriveRow[];
  t: GraphTranslator;
  metaByItem: Record<string, NodeMeta>;
  currentUserId: string | null;
  selectedId?: string;
  /** Non-null in Recent (`resource_id → ISO last_opened_at`): the 4th column shows
   * "Viewed" from it instead of "Modified" from `updated_at`. */
  recentOpenedAt: Record<string, string> | null;
  /** Initial column sort (Recent → viewed-desc; otherwise name-asc). */
  defaultSorting: { id: string; desc: boolean }[];
  /** The starred set + toggle. OPTIONAL (ADR-0025 §1 `star?`): supplied → a leading star
   * column; OMITTED (default OFF, fail-safe) → no star column at all. The structural
   * lenses pass it; the lexical-search list omits it (a ranked hit list has no star). */
  starredSet?: Set<string>;
  onToggleStar?: (nodeId: string, next: boolean) => void;
  /** Browse tree: folders expand inline (a chevron + depth indent in the name cell,
   * `subRows` drive the children). Off → a flat table. */
  tree?: boolean;
  /** Tree expansion mode. `'collapsible'` (default) = the Drive browse tree (opens
   * collapsed, expands on demand). `'always'` = a fully-unfolded tree with no collapse
   * intent — the search advanced list. Ignored when `tree` is false. */
  expansion?: 'collapsible' | 'always';
  /** Wire rows as drag sources / folder rows as drop targets (move = re-parent).
   * Only in 'kb' browse — flat lenses are read-only digests. */
  dndEnabled?: boolean;
  /** The access-mirror badge for a row's node (ADR-0023 §7a), or null when not shared
   * out — rendered in the name cell so the list mirrors the grid cards. */
  sharedBadgeFor?: (node: LensNode) => React.ReactNode;
  /** OPTIONAL trailing column slot rendering a per-row excerpt (the search snippet) —
   * a localized header plus a per-row cell renderer. Absent (default) → no snippet
   * column, so non-search lenses are unchanged (only the search config supplies it). */
  snippet?: { header: string; cell: (node: LensNode) => React.ReactNode };
}) {
  const columns = React.useMemo<ColumnDef<DriveRow>[]>(
    () => [
      // Tree only: a HIDDEN rank (folders/shortcuts 0, files 1) pinned as the primary
      // sort, so "folders first" holds at every level regardless of the column sort
      // direction (the visible column becomes the secondary sort). Auto-hidden by the
      // DataTable's `pinnedSort`.
      ...(tree
        ? [
            {
              id: 'group',
              accessorFn: (r: DriveRow) => (r.rowKind === 'item' ? 1 : 0),
              enableSorting: true,
              sortingFn: 'basic' as const,
              header: '',
              cell: () => null,
            },
          ]
        : []),
      // OPTIONAL leading star column (ADR-0025 §1 `star?`) — present only when a starred
      // set + toggle are supplied (the structural lenses); omitted for the search list.
      ...(starredSet && onToggleStar
        ? [
            {
              id: 'star',
              header: '',
              enableSorting: false,
              // Shortcuts are symlinks, not nodes — nothing to star.
              cell: ({ row }: { row: { original: DriveRow } }) =>
                row.original.rowKind === 'shortcut' ? null : (
                  <StarButton
                    alwaysShow
                    starred={starredSet.has(row.original.node.id)}
                    onToggle={() =>
                      onToggleStar(
                        row.original.node.id,
                        !starredSet.has(row.original.node.id)
                      )
                    }
                    label={t(
                      starredSet.has(row.original.node.id)
                        ? 'graph.drive.unstar'
                        : 'graph.drive.star'
                    )}
                  />
                ),
              meta: { cellClassName: 'w-10' },
            } satisfies ColumnDef<DriveRow>,
          ]
        : []),
      {
        id: 'name',
        accessorFn: (r) => r.node.title,
        header: t('graph.table.name'),
        cell: ({ row }) => {
          const r = row.original;
          const Icon =
            r.rowKind === 'folder'
              ? Folder
              : r.rowKind === 'shortcut'
                ? FolderSymlink
                : iconForKind(r.node.kind);
          return (
            <div
              className="flex min-w-0 items-center gap-2.5"
              style={tree ? { paddingLeft: row.depth * 18 } : undefined}
            >
              {tree ? (
                row.getCanExpand() ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={(event) => {
                      event.stopPropagation();
                      row.getToggleExpandedHandler()();
                    }}
                    className="text-muted-foreground hover:text-foreground -ml-1 h-auto shrink-0 rounded p-0.5 hover:bg-transparent"
                    aria-label={t(
                      row.getIsExpanded()
                        ? 'graph.tree.collapse'
                        : 'graph.tree.expand'
                    )}
                  >
                    <ChevronRight
                      className={cn(
                        'size-3.5 transition-transform',
                        row.getIsExpanded() && 'rotate-90'
                      )}
                      aria-hidden
                    />
                  </Button>
                ) : (
                  // Align leaf rows with the chevron of expandable siblings.
                  <span className="size-3.5 shrink-0" aria-hidden />
                )
              ) : null}
              <Icon
                className="text-muted-foreground size-[18px] shrink-0"
                aria-hidden
              />
              <span className="truncate font-medium">{r.node.title}</span>
              {r.rowKind === 'shortcut' ? (
                <ArrowUpRight
                  className="text-muted-foreground size-3.5 shrink-0"
                  aria-hidden
                />
              ) : (
                (sharedBadgeFor?.(r.node) ?? null)
              )}
            </div>
          );
        },
        meta: { cellClassName: 'max-w-[460px]' },
      },
      {
        id: 'type',
        accessorFn: (r) => kindLabel(t, r.node.kind),
        header: t('graph.table.type'),
        cell: ({ row }) => typeCell(t, row.original.node.kind),
        meta: { cellClassName: 'w-32' },
      },
      {
        id: 'owner',
        accessorFn: (r) =>
          ownerLabel(t, metaByItem[r.node.id]?.ownerUserId, currentUserId),
        header: t('graph.table.owner'),
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{getValue() as string}</span>
        ),
        meta: { cellClassName: 'w-32' },
      },
      // In Recent the timestamp column is "Viewed" (when I last opened it, from the
      // per-user overlay) — the reason the item is here; everywhere else it is
      // "Modified" (the node row's `updated_at`).
      {
        id: recentOpenedAt ? 'viewed' : 'modified',
        accessorFn: (r) =>
          (recentOpenedAt
            ? recentOpenedAt[r.node.id]
            : metaByItem[r.node.id]?.lastModifiedAt) ?? '',
        header: t(
          recentOpenedAt ? 'graph.table.viewed' : 'graph.table.modified'
        ),
        cell: ({ getValue }) =>
          modifiedCell((getValue() as string) || undefined),
        meta: { cellClassName: 'w-32' },
      },
      // OPTIONAL snippet column (search only) — a trailing matched-excerpt slot. Absent
      // by default, so non-search lenses render the original column set unchanged.
      ...(snippet
        ? [
            {
              id: 'snippet',
              enableSorting: false,
              header: snippet.header,
              cell: ({ row }: { row: { original: DriveRow } }) =>
                snippet.cell(row.original.node),
            },
          ]
        : []),
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.actions ? (
            // Stop the row's open/details from firing when using the ⋯ menu.
            <div
              role="presentation"
              className="flex justify-end"
              onClick={(event) => event.stopPropagation()}
            >
              {row.original.actions}
            </div>
          ) : null,
        meta: { cellClassName: 'w-10' },
      },
    ],
    [
      t,
      metaByItem,
      currentUserId,
      starredSet,
      onToggleStar,
      recentOpenedAt,
      tree,
      sharedBadgeFor,
      snippet,
    ]
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      activeRowId={selectedId}
      defaultSorting={defaultSorting}
      // Browse tree: folders expand inline via `subRows`, and a pinned hidden "group"
      // rank keeps folders above files at EVERY level (direction-stable). Flat lenses
      // pass neither → the flat group-order block applies instead.
      getSubRows={tree ? (r) => r.subRows : undefined}
      // Search's advanced tree opens fully-unfolded (`expansion: 'always'`); the Drive
      // browse tree stays collapsible. No-op when `tree` is false.
      defaultExpanded={tree && expansion === 'always'}
      pinnedSort={tree ? 'group' : undefined}
      // Folders + shortcuts (0) always sort as a block above files (1); the
      // column sort applies within each group, so they never interleave.
      groupOrder={(r) => (r.rowKind === 'item' ? 1 : 0)}
      onRowClick={(r) => r.onDetails()}
      onRowActivate={(r) => r.onOpen()}
      // 'kb' browse only: each row is a drag source, folder rows are drop targets
      // (move = re-parent). `useDriveRowDnd` runs inside each row's own component, so
      // its dnd hooks are rules-of-hooks safe across tree expand/collapse.
      rowDnd={dndEnabled ? useDriveRowDnd : undefined}
    />
  );
}
