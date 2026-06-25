'use client';

import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import type { ProjectionResult } from '@workspace/knowledge-contracts';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CardTile } from '@workspace/ui/components/card-tile';
import { iconForKind } from './presentation';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import {
  DriveDragProvider,
  DrivePaneProvider,
  DrivePointerSensor,
  driveCollision,
  useCopyModifier,
  type DriveDragData,
  type DriveDragState,
  type DriveDropData,
} from './drive-dnd';
import { DriveProjectionView } from './views/drive/drive-projection.view';
import { DocumentReader } from './views/document-reader/document-reader.view';
import { useEditLauncher } from './views/document-reader/use-edit-launcher';
import { WorkbenchChrome } from './workbench-chrome';
import { buildContainment } from './containment';
import {
  ResourcePanel,
  type SelectedNode,
} from './views/resource-panel/resource-panel';
import type {
  DriveScope,
  KbViewData,
} from './views/registry/projection-view.types';

/**
 * DriveWorkbench — the workbench host for the Drive shell. It reproduces the
 * prototype `app.jsx` chrome 1:1 for the parts that exist today — the 56px top
 * bar's brand mark + the variant explainer strip — and renders the authoritative
 * `DriveProjectionView` over the server-resolved canvas it is handed.
 *
 * It owns the cross-view UI state the full workbench will own — the selected node
 * id (opens the shared ResourcePanel, a not-yet-ported surface → currently inert)
 * and a `refreshKey` bumped after a mutation; `onMutated` also `router.refresh()`es
 * so the server page re-resolves under the user's RLS.
 *
 * Stripped to the bare shell: a SINGLE `Drive` tab and NO space switcher / search /
 * bell / avatar / theme-density actions / other variant tabs / shared ResourcePanel
 * — those return as their backing features are pulled under the front.
 */
export function DriveWorkbench({
  messages,
  spaceId,
  result,
  kbData,
  initialFolder = null,
  initialDoc = null,
  initialScope = 'kb',
  initialLayout = 'grid',
}: {
  messages: Record<string, string>;
  spaceId?: string;
  result: ProjectionResult;
  kbData?: KbViewData;
  initialFolder?: string | null;
  initialDoc?: string | null;
  initialScope?: DriveScope;
  initialLayout?: 'grid' | 'list';
}) {
  const router = useRouter();
  const t = React.useMemo(() => createGraphTranslator(messages), [messages]);

  // The navigation LOCATION — current folder (`?folder=`, null → root), open
  // document (`?doc=`, the reader overlay), and filter scope (`?scope=`, Starred/
  // Recent) — is mirrored in the URL so it survives refresh and is shareable. But it
  // is held in React STATE seeded from the SERVER-read initial values, NOT read from
  // `useSearchParams` during render: that keeps the SSR'd HTML identical to the
  // client's first render (no hydration mismatch). `pushState` keeps the URL/history
  // in sync; a `popstate` (browser back/forward, the reader's Back) reads it back in.
  // The Details selection stays local (a transient drawer, not a location).
  const [folderId, setFolderId] = React.useState<string | null>(initialFolder);
  const [docId, setDocId] = React.useState<string | null>(initialDoc);
  const [scope, setScope] = React.useState<DriveScope>(initialScope);

  const [selectedId, setSelectedId] = React.useState<string | undefined>(
    undefined
  );
  const [refreshKey, setRefreshKey] = React.useState(0);

  // Dual-pane (Dolphin-style split) — KB-browse only. The SECOND pane is EPHEMERAL: it
  // shares the first pane's ONE sidebar (renders sidebar-less), is always KB-browse,
  // and its folder location is LOCAL (not URL-mirrored — only the primary is
  // shareable). Selection (Details) + the document reader stay SHARED across both panes
  // (they follow the pane you last acted in — both call the same `selectNode`/
  // `openDocument`).
  const [split, setSplit] = React.useState(false);
  const [folderId2, setFolderId2] = React.useState<string | null>(null);

  // The Dolphin-style clipboard — a node MARKED for copy by the `⋯` "Copy" action.
  // It is NOT an immediate write: a Paste affordance appears in each KB-browse pane's
  // toolbar and deep-copies the source into THAT pane's current folder. Persists
  // after a paste (multi-paste) until a new Copy replaces it (or Escape clears it).
  const [clipboard, setClipboard] = React.useState<{
    sourceId: string;
    title: string;
  } | null>(null);

  const refresh = React.useCallback(() => {
    setRefreshKey((key) => key + 1);
    router.refresh();
  }, [router]);

  const copyToClipboard = React.useCallback(
    (sourceId: string, title: string) => {
      setClipboard({ sourceId, title });
    },
    []
  );
  const clearClipboard = React.useCallback(() => setClipboard(null), []);

  // Escape clears the clipboard (Dolphin parity) — a clear, always-available exit.
  React.useEffect(() => {
    if (!clipboard) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setClipboard(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clipboard]);

  // PASTE — deep-copy the clipboard source into a folder (null → top level). The VIEW
  // builds the "X (copy)" rootTitle (it owns `t`); here we just POST under the user's
  // RLS, then re-resolve. Clipboard persists for further pastes.
  const pasteInto = React.useCallback(
    (targetFolderId: string | null, rootTitle: string) => {
      if (!spaceId || !clipboard) {
        return;
      }
      void fetch('/author/graph/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spaceId,
          sourceId: clipboard.sourceId,
          targetFolderId,
          rootTitle,
        }),
      }).then((res) => {
        if (res.ok) {
          refresh();
        }
      });
    },
    [spaceId, clipboard, refresh]
  );

  // ── Trash lens lifecycle (ADR-0018) — RESTORE + PURGE ─────────────────────
  // Both are reached only from the Trash lens and run under the user's RLS via the
  // distinct `/author/graph/trash` route (PATCH = restore, DELETE = purge). The DB
  // guards are the sole authority: an unauthorized restore is a clean no-op; an
  // in-use purge is rejected (the route tags `reason: 'in-use'`). A success
  // re-resolves so the trashed node leaves (restore) / is gone (purge).
  const restoreNode = React.useCallback(
    async (nodeId: string): Promise<boolean> => {
      if (!spaceId) {
        return false;
      }
      const res = await fetch('/author/graph/trash', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceId, resourceId: nodeId }),
      });
      if (res.ok) {
        refresh();
        return true;
      }
      return false;
    },
    [spaceId, refresh]
  );

  const purgeNode = React.useCallback(
    async (nodeId: string): Promise<'purged' | 'in-use' | 'error'> => {
      if (!spaceId) {
        return 'error';
      }
      const res = await fetch('/author/graph/trash', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceId, resourceId: nodeId }),
      });
      if (res.ok) {
        refresh();
        return 'purged';
      }
      // The route distinguishes the in-use guard rejection from any other clean
      // failure (graceful — nothing was destroyed either way).
      const body = (await res.json().catch(() => null)) as {
        reason?: string;
      } | null;
      return body?.reason === 'in-use' ? 'in-use' : 'error';
    },
    [spaceId, refresh]
  );

  // Record a DELIBERATE open of a node — viewing it in Details, opening it in the
  // reader, or navigating INTO a folder (ADR-0016 §3.3). Fire-and-forget under the
  // user's RLS via the opened route (gated by `space.knowledge.open`); a failure
  // NEVER blocks the UI (best-effort, an RLS rejection is a clean no-op). The DB
  // roll-up advances `resource_user_state.last_opened_at` from the appended row. We
  // do NOT re-resolve on an open — the per-user signal is read on the next refresh,
  // not eagerly (no re-render storm on every click / hover-free, only real opens).
  const recordOpen = React.useCallback(
    (nodeId: string) => {
      if (!spaceId) {
        return;
      }
      void fetch('/author/graph/opened', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceId, nodeId }),
      });
    },
    [spaceId]
  );

  // Single-click a node → open the shared Details panel (a deliberate open).
  const selectNode = React.useCallback(
    (id: string) => {
      setSelectedId(id);
      recordOpen(id);
    },
    [recordOpen]
  );

  // Write the location to the URL via the History API (no server re-run): the canvas
  // filters client-side, so navigation never refetches the (identical) data. A
  // relative `?query` keeps the app `basePath`; an empty query clears to the pathname.
  const pushLocation = React.useCallback(
    (loc: { folder: string | null; doc: string | null; scope: DriveScope }) => {
      const params = new URLSearchParams();
      if (loc.folder) params.set('folder', loc.folder);
      if (loc.doc) params.set('doc', loc.doc);
      if (loc.scope !== 'kb') params.set('scope', loc.scope);
      const qs = params.toString();
      window.history.pushState(
        null,
        '',
        qs ? `?${qs}` : window.location.pathname
      );
    },
    []
  );

  // Browser back/forward (and the reader's `router.back()`) change the URL without
  // one of our `pushState`s — sync state back from the URL so the canvas follows
  // history.
  React.useEffect(() => {
    const onPop = () => {
      const p = new URLSearchParams(window.location.search);
      const s = p.get('scope');
      setFolderId(p.get('folder'));
      setDocId(p.get('doc'));
      setScope(
        s === 'home' ||
          s === 'starred' ||
          s === 'recent' ||
          s === 'shared' ||
          s === 'trash'
          ? s
          : 'kb'
      );
      setSelectedId(undefined);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Browse the tree → a folder (null = root). Clears a now-stale selection + open
  // doc and returns to the 'kb' scope (the flat filters are not folders you enter).
  const goFolder = React.useCallback(
    (id: string | null) => {
      setSelectedId(undefined);
      setFolderId(id);
      setDocId(null);
      setScope('kb');
      pushLocation({ folder: id, doc: null, scope: 'kb' });
      if (id) {
        recordOpen(id); // entering a folder is a deliberate open (root is not a node)
      }
    },
    [pushLocation, recordOpen]
  );

  // Switch the sidebar filter (kb / starred / recent) — a shareable location. Leaving
  // KB closes the split (it is a KB-browse-only affordance).
  const goScope = React.useCallback(
    (next: DriveScope) => {
      setSelectedId(undefined);
      setScope(next);
      if (next !== 'kb') {
        setSplit(false);
      }
      pushLocation({ folder: folderId, doc: docId, scope: next });
    },
    [pushLocation, folderId, docId]
  );

  // Second pane — folder navigation only, LOCAL (no URL): the ephemeral split view.
  const goFolder2 = React.useCallback(
    (id: string | null) => {
      setFolderId2(id);
      if (id) {
        recordOpen(id);
      }
    },
    [recordOpen]
  );

  // Toggle the split. Opening mirrors the primary pane's current folder, then the two
  // diverge independently.
  const toggleSplit = React.useCallback(() => {
    if (!split) {
      setFolderId2(folderId);
    }
    setSplit((on) => !on);
  }, [split, folderId]);

  // Open a document in the reader overlay (dismiss the transient Details panel).
  const openDocument = React.useCallback(
    (id: string) => {
      setSelectedId(undefined);
      setDocId(id);
      pushLocation({ folder: folderId, doc: id, scope });
      recordOpen(id);
    },
    [pushLocation, folderId, scope, recordOpen]
  );

  // Containment over the resolved canvas — fed to the panel (Move folder picker)
  // AND the drag-and-drop guard (a folder can't drop into itself / a descendant).
  const containment = React.useMemo(
    () => buildContainment(result.items, kbData?.containment ?? []),
    [result.items, kbData]
  );

  // ── Drag & drop (move = re-parent; Alt-held = copy) ───────────────────────
  // ONE DndContext spans both split panes (declared in JSX below), so a drag from
  // pane A can drop onto a folder in pane B. Folder/root targets are ABSOLUTE (a
  // graph node id / top-level), so no per-pane folder threading is needed.
  const dndSensors = useSensors(
    // A small activation distance so a click still selects/opens a row (the
    // single/double-click split is preserved) — only a real drag past 6px starts DnD.
    useSensor(DrivePointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );
  const copyHeld = useCopyModifier();
  const [dragData, setDragData] = React.useState<DriveDragData | null>(null);
  // The live drag, shared with every droppable so valid landing zones light up the
  // moment a drag starts (folders + the root). Null between drags.
  const [dragState, setDragState] = React.useState<DriveDragState | null>(null);

  // Is `folderId` the node itself or a descendant of `nodeId`? (a folder may not be
  // re-parented into its own subtree — that would orphan the cycle).
  const isSelfOrDescendant = React.useCallback(
    (nodeId: string, folderId: string): boolean => {
      if (nodeId === folderId) {
        return true;
      }
      let cursor: string | undefined = folderId;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor)) {
        if (cursor === nodeId) {
          return true;
        }
        seen.add(cursor);
        cursor = containment.parentOf.get(cursor);
      }
      return false;
    },
    [containment]
  );

  const onDragStart = React.useCallback(
    (event: DragStartEvent) => {
      const data = event.active.data.current as DriveDragData | undefined;
      setDragData(data ?? null);
      setDragState(
        data
          ? {
              activeId: data.nodeId,
              isInvalidTarget: (folderId) =>
                isSelfOrDescendant(data.nodeId, folderId),
            }
          : null
      );
    },
    [isSelfOrDescendant]
  );

  const endDrag = React.useCallback(() => {
    setDragData(null);
    setDragState(null);
  }, []);

  const onDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const active = event.active.data.current as DriveDragData | undefined;
      const over = event.over?.data.current as DriveDropData | undefined;
      endDrag();
      if (!active || !over || !spaceId) {
        return;
      }
      const targetFolderId = over.type === 'folder' ? over.folderId : null;
      const currentParent = containment.parentOf.get(active.nodeId) ?? null;
      const copy = copyHeld.current;

      // Move guards: a no-op drop (already in this folder, or onto itself) and the
      // self/descendant cycle. Copy has no such restriction — a copy into the same
      // folder is a legitimate duplicate.
      if (!copy) {
        if (targetFolderId === currentParent) {
          return; // already here (root→root or same folder) — nothing to do.
        }
        if (
          targetFolderId &&
          isSelfOrDescendant(active.nodeId, targetFolderId)
        ) {
          return; // can't move a folder into its own subtree.
        }
      } else if (
        targetFolderId &&
        isSelfOrDescendant(active.nodeId, targetFolderId)
      ) {
        return; // copying a folder into its own subtree would recurse — skip.
      }

      if (copy) {
        // Copying into the SAME folder is a duplicate — suffix "(copy)" so it is not a
        // same-named sibling. A copy to a DIFFERENT folder keeps the name (no clash),
        // matching Finder/Dolphin.
        const rootTitle =
          targetFolderId === currentParent
            ? t('graph.panel.copySuffix', { title: active.title })
            : undefined;
        void fetch('/author/graph/copy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            spaceId,
            sourceId: active.nodeId,
            targetFolderId,
            ...(rootTitle ? { rootTitle } : {}),
          }),
        }).then((res) => {
          if (res.ok) {
            refresh();
          }
        });
        return;
      }

      // Move = re-parent: drop the current contains edge, then (unless top level)
      // add a contains edge from the target folder — the same dance the ⋯ Move uses.
      void (async () => {
        let ok = true;
        if (currentParent) {
          const res = await fetch('/author/graph/edges', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              spaceId,
              fromId: currentParent,
              toId: active.nodeId,
              relationType: 'contains',
            }),
          });
          ok = res.ok;
        }
        if (ok && targetFolderId) {
          const res = await fetch('/author/graph/edges', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'contain',
              spaceId,
              folderId: targetFolderId,
              childId: active.nodeId,
            }),
          });
          ok = res.ok;
        }
        if (ok) {
          refresh();
        }
      })();
    },
    [spaceId, containment, copyHeld, isSelfOrDescendant, refresh, endDrag, t]
  );

  const selectedNode = React.useMemo<SelectedNode | null>(() => {
    if (!selectedId) {
      return null;
    }
    const item = result.items.find((entry) => entry.id === selectedId);
    return item
      ? {
          id: item.id,
          kind: item.kind,
          title: item.title,
          status: item.status,
        }
      : null;
  }, [selectedId, result.items]);

  // The open document's title (the reader header). A mutation that removed it
  // collapses the reader back to the Drive grid.
  const openDoc = React.useMemo(() => {
    if (!docId) {
      return null;
    }
    const item = result.items.find((entry) => entry.id === docId);
    return item ? { id: item.id, title: item.title } : null;
  }, [docId, result.items]);

  // The ONE "edit this document" launcher (seed-choice flow + chooser), shared by
  // the reader's Edit button and the `⋯` context menus on cards and the panel.
  const { requestEdit, chooser, preparingEdit } = useEditLauncher({
    spaceId: spaceId ?? '',
    messages,
  });

  // One Drive pane. Navigation (folder/scope) is per-pane; selection, the reader, the
  // resolved canvas and the split toggle are shared.
  const renderPane = (
    paneFolderId: string | null,
    paneScope: DriveScope,
    onNav: (id: string | null) => void,
    onScopeChg: ((next: DriveScope) => void) | undefined,
    hideSidebar = false
  ) => (
    <DriveProjectionView
      result={result}
      messages={messages}
      spaceId={spaceId}
      kbData={kbData}
      selectedId={selectedId}
      onSelect={selectNode}
      onEditNode={spaceId ? requestEdit : undefined}
      onOpenDocument={openDocument}
      folderId={paneFolderId}
      onNavigate={onNav}
      scope={paneScope}
      onScopeChange={onScopeChg}
      initialLayout={initialLayout}
      onMutated={refresh}
      refreshKey={refreshKey}
      split={split}
      onToggleSplit={toggleSplit}
      hideSidebar={hideSidebar}
      clipboard={clipboard}
      onCopyToClipboard={copyToClipboard}
      onPaste={pasteInto}
      onClearClipboard={clearClipboard}
      onRestore={restoreNode}
      onPurge={purgeNode}
    />
  );

  return (
    <div className="bg-background text-foreground flex h-dvh flex-col overflow-hidden">
      <WorkbenchChrome messages={messages} />

      {/* body: a flex row — the content area (Drive projection, with the document
          read-view overlaying it) grows; the shared Details panel is an INLINE
          right column that shrinks the content beside it when a node is selected */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="relative flex min-w-0 flex-1 overflow-hidden">
          {/* ONE DndContext over BOTH panes: a node dragged in pane A drops onto a
              folder in pane B (folder/root targets are absolute graph ids). The custom
              `driveCollision` prefers a folder over the nested root zone (empty canvas /
              breadcrumb = root). The overlay shows the dragged node's title. `dragState`
              lights up valid landing zones for every droppable the moment a drag starts. */}
          <DndContext
            id="drive-dnd"
            sensors={dndSensors}
            collisionDetection={driveCollision}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={endDrag}
          >
            <DriveDragProvider value={dragState}>
              {split ? (
                <div className="flex min-w-0 flex-1 overflow-hidden">
                  {/* primary pane carries the one shared sidebar; secondary is sidebar-less,
                      always KB-browse, navigating independently. Each pane namespaces its
                      dnd ids (a/b) so the SAME node rendered in both does not collide. */}
                  <div className="flex min-w-0 flex-1 overflow-hidden border-r">
                    <DrivePaneProvider value="a">
                      {renderPane(folderId, scope, goFolder, goScope)}
                    </DrivePaneProvider>
                  </div>
                  <div className="flex min-w-0 flex-1 overflow-hidden">
                    <DrivePaneProvider value="b">
                      {renderPane(folderId2, 'kb', goFolder2, undefined, true)}
                    </DrivePaneProvider>
                  </div>
                </div>
              ) : (
                <DrivePaneProvider value="a">
                  {renderPane(folderId, scope, goFolder, goScope)}
                </DrivePaneProvider>
              )}
            </DriveDragProvider>

            <DragOverlay dropAnimation={null}>
              {dragData ? (
                <CardTile className="pointer-events-none w-[240px] gap-2.5 px-3.5 py-2.5 shadow-lg">
                  {React.createElement(iconForKind(dragData.kind), {
                    className: 'text-muted-foreground size-[18px] shrink-0',
                    'aria-hidden': true,
                  })}
                  <span className="truncate text-sm font-medium">
                    {dragData.title}
                  </span>
                </CardTile>
              ) : null}
            </DragOverlay>
          </DndContext>

          {spaceId && openDoc ? (
            <DocumentReader
              key={openDoc.id}
              spaceId={spaceId}
              nodeId={openDoc.id}
              title={openDoc.title}
              messages={messages}
              containment={containment}
              onClose={() => {
                // Pop the `?doc=` entry (popstate restores the folder/scope), then
                // re-resolve so the canvas REBUILDS with current server data — a
                // change made while reading (a body edit / publish, or the activity
                // recency just recorded) otherwise leaves the folder showing stale
                // contents until a manual page refresh.
                router.back();
                refresh();
              }}
              onEdit={() => requestEdit(openDoc.id)}
              onMutated={refresh}
              preparingEdit={preparingEdit}
            />
          ) : null}
        </div>

        {/* shared Details panel — single-click a node opens it (the authoritative
            surface); it renders nothing (no width) while no node is selected */}
        {spaceId ? (
          <ResourcePanel
            spaceId={spaceId}
            messages={messages}
            node={selectedNode}
            attributes={
              selectedNode
                ? kbData?.attributesByItem[selectedNode.id]
                : undefined
            }
            containment={containment}
            open={selectedNode != null}
            onOpenChange={(isOpen) => {
              if (!isOpen) {
                setSelectedId(undefined);
              }
            }}
            onMutated={refresh}
            onEdit={requestEdit}
          />
        ) : null}
      </div>

      {/* The shared edit-source chooser (opens when a published doc has drafts). */}
      {chooser}
    </div>
  );
}
