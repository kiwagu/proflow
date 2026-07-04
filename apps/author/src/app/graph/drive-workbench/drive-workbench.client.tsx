'use client';

import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import type { ProjectionResult } from '@workspace/knowledge-contracts';
import { DndContext, DragOverlay } from '@dnd-kit/core';
import { CardTile } from '@workspace/ui/components/card-tile';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { iconForKind } from '../presentation';
import {
  DriveDragProvider,
  DrivePaneProvider,
  driveCollision,
} from '../drive-dnd';
import { CommandPalette } from '../command-palette/command-palette';
import { CommandPaletteTrigger } from '../command-palette/command-palette-trigger';
import { useCommandPalette } from '../command-palette/use-command-palette';
import { DriveProjectionView } from '../views/drive';
import { SearchView } from '../views/search/search.view';
import { DocumentReader } from '../views/document-reader/document-reader.view';
import { WorkbenchChrome } from '../workbench-chrome';
import { ResourcePanel } from '../views/resource-panel';
import type { ResourceFloor } from '../graph-data.types';
import type {
  DriveScope,
  KbViewData,
  LensView,
} from '../views/registry/projection-view.types';
import { useDriveCanvasDerivations } from './use-drive-canvas-derivations';
import { useDriveClipboard } from './use-drive-clipboard';
import { useDriveDnd } from './use-drive-dnd';
import { useDriveMutations } from './use-drive-mutations';
import { useDriveNavigation } from './use-drive-navigation';
import { useDriveSelection } from './use-drive-selection';
import { useDriveSplitReader } from './use-drive-split-reader';

/**
 * DriveWorkbench — the workbench host for the Drive shell. It reproduces the
 * prototype `app.jsx` chrome 1:1 for the parts that exist today — the 56px top
 * bar's brand mark + the variant explainer strip — and renders the authoritative
 * `DriveProjectionView` over the server-resolved canvas it is handed.
 *
 * It is a THIN composition: the cross-view stateful clusters live in co-located hooks
 * (navigation + URL/history sync, selection/Details, the dual-pane split + reader,
 * clipboard, mutations + Trash lifecycle, DnD orchestration, and the canvas derivations
 * the panel/DnD read). This component only wires them together and renders the chrome,
 * the projection panes (or the search lens), the document reader, and the Details panel.
 *
 * Stripped to the bare shell: a SINGLE `Drive` tab and NO space switcher / bell / avatar /
 * theme-density actions / other variant tabs — those return as their backing features are
 * pulled under the front.
 */
export function DriveWorkbench({
  messages,
  spaceId,
  result,
  kbData,
  initialFolder = null,
  initialDoc = null,
  initialScope = 'kb',
  initialSearchTerm = '',
  initialLensView = 'flat',
  initialLayout = 'grid',
}: {
  messages: Record<string, string>;
  spaceId?: string;
  result: ProjectionResult;
  kbData?: KbViewData;
  initialFolder?: string | null;
  initialDoc?: string | null;
  initialScope?: DriveScope;
  /** The `?q=` search term, read SERVER-SIDE so a deep-linked search lens SSRs with
   * its term (no hydration flip). Only meaningful when `initialScope === 'search'`. */
  initialSearchTerm?: string;
  initialLensView?: LensView;
  initialLayout?: 'grid' | 'list';
}) {
  const router = useRouter();
  const t = React.useMemo(() => createGraphTranslator(messages), [messages]);

  const advancedStructuralEntitled =
    kbData?.entitlements?.advancedStructuralView ?? false;

  // The command palette (ADR-0024 §5, slice-12 Phase 3) — the SECOND consumer of the
  // lexical-search capability, proving it is not Drive-bound. Toggled by ⌘K/Ctrl+K (the
  // hook) or the chrome trigger; it reuses the SAME `/author/graph/search` path the
  // Drive lens uses and opens a selected hit through THIS workbench's existing nav.
  const commandPalette = useCommandPalette();

  // Selection / Details drawer (transient — not a URL location).
  const selection = useDriveSelection({ spaceId, result });

  // Navigation LOCATION + URL/history sync (folder/doc/scope/search/lens).
  const nav = useDriveNavigation({
    initialFolder,
    initialDoc,
    initialScope,
    initialSearchTerm,
    initialLensView,
    advancedStructuralEntitled,
    clearSelection: selection.clearSelection,
    recordOpen: selection.recordOpen,
  });

  // Dual-pane split + the shared document-reader/edit launcher.
  const splitReader = useDriveSplitReader({
    spaceId,
    messages,
    primaryFolderId: nav.folderId,
    recordOpen: selection.recordOpen,
  });

  // Canvas derivations (containment + access-mirror maps) + the "Open in KB" reveal.
  const derivations = useDriveCanvasDerivations({
    result,
    kbData,
    lensView: nav.lensView,
    setFolderId: nav.setFolderId,
    setDocId: nav.setDocId,
    setScope: nav.setScope,
    setSelectedId: selection.setSelectedId,
    setSplit: splitReader.setSplit,
    pushLocation: nav.pushLocation,
    recordOpen: selection.recordOpen,
  });

  // The restore-from-trash hand-off: queue the deferred KB reveal, then reset the
  // location/selection so the kb lens is showing when the re-resolved containment lands.
  const onRestored = React.useCallback(
    (nodeId: string) => {
      derivations.revealAfterRefresh(nodeId);
      nav.setScope('kb');
      nav.setFolderId(null);
      nav.setDocId(null);
      selection.setSelectedId(undefined);
    },
    [derivations, nav, selection]
  );

  // Refresh + Trash lifecycle (restore / purge).
  const { refreshKey, refresh, restoreNode, purgeNode, removeShortcut } =
    useDriveMutations({
      spaceId,
      onRestored,
    });

  // Clipboard (Dolphin copy/paste).
  const clipboard = useDriveClipboard({ spaceId, refresh });

  // DnD orchestration (move / Alt-copy) over the resolved containment.
  const dnd = useDriveDnd({
    spaceId,
    containment: derivations.containment,
    refresh,
    copySuffix: (title) => t('graph.panel.copySuffix', { title }),
  });

  const openDoc = React.useMemo(() => {
    if (!nav.docId) {
      return null;
    }
    const item = result.items.find((entry) => entry.id === nav.docId);
    return item ? { id: item.id, title: item.title } : null;
  }, [nav.docId, result.items]);

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
      selectedId={selection.selectedId}
      onSelect={selection.selectNode}
      onEditNode={spaceId ? splitReader.requestEdit : undefined}
      onRevealInKb={derivations.revealInKb}
      onOpenDocument={nav.openDocument}
      folderId={paneFolderId}
      onNavigate={onNav}
      scope={paneScope}
      onScopeChange={onScopeChg}
      lensView={nav.lensView}
      onLensViewChange={nav.goLensView}
      initialLayout={initialLayout}
      onMutated={refresh}
      refreshKey={refreshKey}
      split={splitReader.split}
      onToggleSplit={splitReader.toggleSplit}
      hideSidebar={hideSidebar}
      clipboard={clipboard.clipboard}
      onCopyToClipboard={clipboard.copyToClipboard}
      onPaste={clipboard.pasteInto}
      onPasteShortcut={clipboard.pasteAsShortcutInto}
      onClearClipboard={clipboard.clearClipboard}
      onRestore={restoreNode}
      onPurge={purgeNode}
      onRemoveShortcut={removeShortcut}
    />
  );

  // The primary pane's scope change closes the split (a KB-browse-only affordance).
  const goScope = React.useCallback(
    (next: DriveScope) => nav.goScope(next, () => splitReader.setSplit(false)),
    [nav, splitReader]
  );

  return (
    <div className="bg-background text-foreground flex h-dvh flex-col overflow-hidden">
      <WorkbenchChrome
        messages={messages}
        actions={
          spaceId ? (
            <CommandPaletteTrigger
              messages={messages}
              onOpen={() => commandPalette.setOpen(true)}
            />
          ) : undefined
        }
      />

      {/* The command palette (slice-12 Phase 3) — the SECOND consumer of the lexical-
          search capability. ⌘K/Ctrl+K (the hook) or the chrome trigger opens it; it
          reuses the SAME `/author/graph/search` path the Drive lens uses and routes a
          selected hit through THIS workbench's existing nav (reader for a `text` node,
          the shared Details panel for anything else — identical to a Drive search row). */}
      {spaceId ? (
        <CommandPalette
          messages={messages}
          spaceId={spaceId}
          open={commandPalette.open}
          onOpenChange={commandPalette.setOpen}
          handlers={{
            onOpenDocument: nav.openDocument,
            onOpenFolder: nav.goFolder,
            onSelect: (item) =>
              selection.selectSearchHit({
                id: item.id,
                kind: item.kind,
                title: item.title,
                status: item.status,
                visibility: item.visibility as ResourceFloor,
              }),
          }}
        />
      ) : null}

      {/* body: a flex row — the content area (Drive projection, with the document
          read-view overlaying it) grows; the shared Details panel is an INLINE
          right column that shrinks the content beside it when a node is selected */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="relative flex min-w-0 flex-1 overflow-hidden">
          {/* The lexical-search lens (ADR-0024 §5) REPLACES the projection panes when
              the 'search' scope is active — it is a substrate-capability surface, not a
              projection over the resolved canvas, so it owns its own toolbar + results
              and needs no DndContext (search rows are not draggable). Single-click a row
              opens the SAME shared ResourcePanel via `selectNode`; a `text` row opens the
              reader via `openDocument` — identical to the Drive cards. */}
          {nav.scope === 'search' ? (
            <SearchView
              messages={messages}
              spaceId={spaceId}
              initialTerm={nav.searchTerm}
              selectedId={selection.selectedId}
              onSelect={selection.selectSearchHit}
              onOpenDocument={nav.openDocument}
              onOpenFolder={nav.goFolder}
              kbData={kbData}
              onTermChange={nav.setSearch}
              containment={derivations.containment}
              onScopeChange={goScope}
              onNavigate={nav.goFolder}
              onMutated={refresh}
              onRevealInKb={derivations.revealInKb}
              lensView={nav.lensView}
              onLensViewChange={nav.goLensView}
              initialLayout={initialLayout}
            />
          ) : (
            /* ONE DndContext over BOTH panes: a node dragged in pane A drops onto a
              folder in pane B (folder/root targets are absolute graph ids). The custom
              `driveCollision` prefers a folder over the nested root zone (empty canvas /
              breadcrumb = root). The overlay shows the dragged node's title. `dragState`
              lights up valid landing zones for every droppable the moment a drag starts. */
            <DndContext
              id="drive-dnd"
              sensors={dnd.dndSensors}
              collisionDetection={driveCollision}
              onDragStart={dnd.onDragStart}
              onDragEnd={dnd.onDragEnd}
              onDragCancel={dnd.endDrag}
            >
              <DriveDragProvider value={dnd.dragState}>
                {splitReader.split ? (
                  <div className="flex min-w-0 flex-1 overflow-hidden">
                    {/* primary pane carries the one shared sidebar; secondary is sidebar-less,
                      always KB-browse, navigating independently. Each pane namespaces its
                      dnd ids (a/b) so the SAME node rendered in both does not collide. */}
                    <div className="flex min-w-0 flex-1 overflow-hidden border-r">
                      <DrivePaneProvider value="a">
                        {renderPane(
                          nav.folderId,
                          nav.scope,
                          nav.goFolder,
                          goScope
                        )}
                      </DrivePaneProvider>
                    </div>
                    <div className="flex min-w-0 flex-1 overflow-hidden">
                      <DrivePaneProvider value="b">
                        {renderPane(
                          splitReader.folderId2,
                          'kb',
                          splitReader.goFolder2,
                          undefined,
                          true
                        )}
                      </DrivePaneProvider>
                    </div>
                  </div>
                ) : (
                  <DrivePaneProvider value="a">
                    {renderPane(nav.folderId, nav.scope, nav.goFolder, goScope)}
                  </DrivePaneProvider>
                )}
              </DriveDragProvider>

              <DragOverlay dropAnimation={null}>
                {dnd.dragData ? (
                  <CardTile className="pointer-events-none w-[240px] gap-2.5 px-3.5 py-2.5 shadow-lg">
                    {React.createElement(iconForKind(dnd.dragData.kind), {
                      className: 'text-muted-foreground size-[18px] shrink-0',
                      'aria-hidden': true,
                    })}
                    <span className="truncate text-sm font-medium">
                      {dnd.dragData.title}
                    </span>
                  </CardTile>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}

          {spaceId && openDoc ? (
            <DocumentReader
              key={openDoc.id}
              spaceId={spaceId}
              nodeId={openDoc.id}
              title={openDoc.title}
              messages={messages}
              containment={derivations.containment}
              currentUserId={kbData?.currentUserId ?? null}
              ownerUserId={kbData?.metaByItem[openDoc.id]?.ownerUserId ?? null}
              capabilities={
                kbData?.capabilities ?? {
                  canUpdate: false,
                  canDelete: false,
                  canCreate: false,
                  canAccess: false,
                }
              }
              onClose={() => {
                // Pop the `?doc=` entry (popstate restores the folder/scope), then
                // re-resolve so the canvas REBUILDS with current server data — a
                // change made while reading (a body edit / publish, or the activity
                // recency just recorded) otherwise leaves the folder showing stale
                // contents until a manual page refresh.
                router.back();
                refresh();
              }}
              onEdit={() => splitReader.requestEdit(openDoc.id)}
              onMutated={refresh}
              preparingEdit={splitReader.preparingEdit}
            />
          ) : null}
        </div>

        {/* shared Details panel — single-click a node opens it (the authoritative
            surface); it renders nothing (no width) while no node is selected */}
        {spaceId ? (
          <ResourcePanel
            spaceId={spaceId}
            messages={messages}
            node={selection.selectedNode}
            attributes={
              selection.selectedNode
                ? kbData?.attributesByItem[selection.selectedNode.id]
                : undefined
            }
            tags={
              selection.selectedNode
                ? (kbData?.tagsByItem[selection.selectedNode.id] ?? [])
                : []
            }
            spaceTags={kbData?.spaceTags ?? []}
            containment={derivations.containment}
            currentUserId={kbData?.currentUserId ?? null}
            ownerUserId={
              selection.selectedNode
                ? (kbData?.metaByItem[selection.selectedNode.id]?.ownerUserId ??
                  null)
                : null
            }
            capabilities={
              kbData?.capabilities ?? {
                canUpdate: false,
                canDelete: false,
                canCreate: false,
                canAccess: false,
              }
            }
            visibility={
              selection.selectedNode
                ? (kbData?.metaByItem[selection.selectedNode.id]?.visibility ??
                  selection.fallbackSelection?.visibility ??
                  null)
                : null
            }
            grantees={
              selection.selectedNode
                ? (derivations.sharedByMeGranteesById.get(
                    selection.selectedNode.id
                  ) ?? [])
                : []
            }
            sharedByMeIds={derivations.sharedByMeIds}
            visibilityById={derivations.visibilityById}
            open={selection.selectedNode != null}
            onOpenChange={(isOpen) => {
              if (!isOpen) {
                selection.setSelectedId(undefined);
              }
            }}
            onMutated={refresh}
            onEdit={splitReader.requestEdit}
            onOpenInKb={derivations.revealInKb}
          />
        ) : null}
      </div>

      {/* The shared edit-source chooser (opens when a published doc has drafts). */}
      {splitReader.chooser}
    </div>
  );
}
