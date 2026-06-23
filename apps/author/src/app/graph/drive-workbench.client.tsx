'use client';

import type { ProjectionResult } from '@workspace/knowledge-contracts';
import { useRouter } from 'next/navigation';
import * as React from 'react';

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
}: {
  messages: Record<string, string>;
  spaceId?: string;
  result: ProjectionResult;
  kbData?: KbViewData;
  initialFolder?: string | null;
  initialDoc?: string | null;
  initialScope?: DriveScope;
}) {
  const router = useRouter();

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

  const refresh = React.useCallback(() => {
    setRefreshKey((key) => key + 1);
    router.refresh();
  }, [router]);

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
      setScope(s === 'starred' || s === 'recent' ? s : 'kb');
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
    },
    [pushLocation]
  );

  // Switch the sidebar filter (kb / starred / recent) — a shareable location.
  const goScope = React.useCallback(
    (next: DriveScope) => {
      setSelectedId(undefined);
      setScope(next);
      pushLocation({ folder: folderId, doc: docId, scope: next });
    },
    [pushLocation, folderId, docId]
  );

  // Open a document in the reader overlay (dismiss the transient Details panel).
  const openDocument = React.useCallback(
    (id: string) => {
      setSelectedId(undefined);
      setDocId(id);
      pushLocation({ folder: folderId, doc: id, scope });
    },
    [pushLocation, folderId, scope]
  );

  // Containment over the resolved canvas — fed to the panel (Move folder picker).
  const containment = React.useMemo(
    () => buildContainment(result.items, kbData?.containment ?? []),
    [result.items, kbData]
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

  return (
    <div className="bg-background text-foreground flex h-dvh flex-col overflow-hidden">
      <WorkbenchChrome messages={messages} />

      {/* body: a flex row — the content area (Drive projection, with the document
          read-view overlaying it) grows; the shared Details panel is an INLINE
          right column that shrinks the content beside it when a node is selected */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="relative flex min-w-0 flex-1 overflow-hidden">
          <DriveProjectionView
            result={result}
            messages={messages}
            spaceId={spaceId}
            kbData={kbData}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onEditNode={spaceId ? requestEdit : undefined}
            onOpenDocument={openDocument}
            folderId={folderId}
            onNavigate={goFolder}
            scope={scope}
            onScopeChange={goScope}
            onMutated={refresh}
            refreshKey={refreshKey}
          />

          {spaceId && openDoc ? (
            <DocumentReader
              key={openDoc.id}
              spaceId={spaceId}
              nodeId={openDoc.id}
              title={openDoc.title}
              messages={messages}
              containment={containment}
              onClose={() => router.back()}
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
