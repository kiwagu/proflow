'use client';

import type { ProjectionResult } from '@workspace/knowledge-contracts';
import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import {
  SegmentedControl,
  SegmentedControlButton,
} from '@workspace/ui/components/segmented-control';
import { FolderTree, Info } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import { DriveProjectionView } from './views/drive/drive-projection.view';
import { DocumentReader } from './views/document-reader/document-reader.view';
import { buildContainment } from './containment';
import {
  ResourcePanel,
  type SelectedNode,
} from './views/resource-panel/resource-panel';
import type { KbViewData } from './views/registry/projection-view.types';

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
}: {
  messages: Record<string, string>;
  spaceId?: string;
  result: ProjectionResult;
  kbData?: KbViewData;
}) {
  const t = React.useMemo(() => createGraphTranslator(messages), [messages]);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Navigation state lives in the URL so it survives refresh and browser history:
  //  - `?folder=` the current folder (null → root),
  //  - `?doc=` the open document (a kind=text node, read in the overlay).
  // The Details selection stays local (a transient drawer, not a location).
  const folderId = searchParams.get('folder');
  const docId = searchParams.get('doc');

  const [selectedId, setSelectedId] = React.useState<string | undefined>(
    undefined
  );
  const [refreshKey, setRefreshKey] = React.useState(0);

  const refresh = React.useCallback(() => {
    setRefreshKey((key) => key + 1);
    router.refresh();
  }, [router]);

  // Patch the navigation query string via the native History API (SHALLOW): it
  // updates the URL + `useSearchParams` WITHOUT re-running the server component,
  // so folder/document navigation never refetches the (identical) canvas — the
  // page ignores searchParams and folder filtering is client-side. `pushState`
  // still records a history entry, so opening a document from a folder
  // (`?folder=X&doc=Y`) lets the reader's Back (and the browser's) return to
  // `?folder=X`. A full refresh re-runs the server once, as expected.
  const navigate = React.useCallback(
    (next: { folder?: string | null; doc?: string | null }) => {
      const params = new URLSearchParams(searchParams.toString());
      if ('folder' in next) {
        if (next.folder) params.set('folder', next.folder);
        else params.delete('folder');
      }
      if ('doc' in next) {
        if (next.doc) params.set('doc', next.doc);
        else params.delete('doc');
      }
      const qs = params.toString();
      window.history.pushState(null, '', qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, searchParams]
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

  return (
    <div className="bg-background text-foreground flex h-dvh flex-col overflow-hidden">
      {/* top bar (prototype `app.jsx` header, 56px) — brand + single Drive tab */}
      <header className="flex h-14 shrink-0 items-center gap-[14px] border-b px-4">
        <div className="flex items-center gap-[9px]">
          <span
            aria-hidden
            className="bg-primary text-primary-foreground grid size-[26px] place-items-center rounded-md text-xs font-bold"
          >
            P
          </span>
          <span className="text-base font-bold tracking-tight">
            {t('graph.topbar.brand')}
          </span>
        </div>

        {/* single live variant — `Drive` (no other tabs, no space switcher) */}
        <div className="mx-auto">
          <SegmentedControl>
            <SegmentedControlButton active>
              <FolderTree className="size-[15px]" aria-hidden />
              {t('graph.variant.drive')}
            </SegmentedControlButton>
          </SegmentedControl>
        </div>
      </header>

      {/* variant explainer strip (prototype VARIANT_NOTE) */}
      <div className="bg-muted/40 text-muted-foreground flex shrink-0 items-center gap-2 border-b px-[18px] py-2 text-[13px]">
        <Info className="size-3.5 shrink-0" aria-hidden />
        <span>
          <strong className="text-foreground font-semibold">
            {t('graph.variant.drive')}:
          </strong>{' '}
          {t('graph.variant.driveNote')}
        </span>
      </div>

      {/* body: the Drive projection fills the remaining area; the document
          read-view overlays it when a document is open */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <DriveProjectionView
          result={result}
          messages={messages}
          spaceId={spaceId}
          kbData={kbData}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onOpenDocument={(id) => navigate({ doc: id })}
          folderId={folderId}
          onNavigate={(id) => navigate({ folder: id, doc: null })}
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
            onClose={() => router.back()}
          />
        ) : null}
      </div>

      {/* shared node-action drawer — opens on select (the authoritative surface) */}
      {spaceId ? (
        <ResourcePanel
          spaceId={spaceId}
          messages={messages}
          node={selectedNode}
          attributes={
            selectedNode ? kbData?.attributesByItem[selectedNode.id] : undefined
          }
          containment={containment}
          open={selectedNode != null}
          onOpenChange={(isOpen) => {
            if (!isOpen) {
              setSelectedId(undefined);
            }
          }}
          onMutated={refresh}
        />
      ) : null}
    </div>
  );
}
