import type { DocumentMeta } from '@workspace/domain';
import type { WorkbenchTranslator } from '@workspace/i18n-catalogs/workbench';
import {
  createWorkbenchTranslator,
  loadWorkbenchMessages,
} from '@workspace/i18n-catalogs/workbench';
import { Button } from '@workspace/ui/components/button';
import { WorkbenchChrome } from '@workspace/ui/components/platform/workbench-chrome';
import { WorkbenchShell } from '@workspace/ui/components/workbench-shell';
import {
  buildFileExplorerLabels,
  defaultFileExplorerLabels,
  FileExplorer,
  FilePane,
  FileSelectionProvider,
  FileServicesProvider,
  useFileSelection,
  type DocumentActions,
  type FileExplorerLabels,
  type FileServices,
} from '@workspace/workbench-files';
import {
  buildCommandPaletteLabels,
  CommandPalette,
  defaultCommandPaletteLabels,
  GraphServicesProvider,
  useCommandPalette,
  type CommandPaletteHandlers,
  type CommandPaletteLabels,
  type GraphServices,
} from '@workspace/workbench-graph';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useServices } from './composition/app-services';
import { DocumentPane } from './features/document-pane';
import { SIDEBAR_WIDTH } from './shell/layout';

/**
 * Loads the workbench catalog once for the app's locale and hands back a
 * translator — the seam every workbench chrome surface (explorer, palette)
 * reads its labels through. `null` while the catalog is loading.
 */
function useWorkbenchTranslator(): WorkbenchTranslator | null {
  const [t, setT] = useState<WorkbenchTranslator | null>(null);
  useEffect(() => {
    let cancelled = false;
    // The app has no locale switcher yet; English is the only wired
    // locale until one is added — the catalog itself already has ES.
    void loadWorkbenchMessages('en').then((messages) => {
      if (!cancelled) setT(() => createWorkbenchTranslator(messages));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return t;
}

/**
 * The workbench: the explorer on the left, the selected node in the pane,
 * and the command palette over the local title index. Every surface here
 * is a package component fed through its provider; the app only wires
 * the ports the composition root built.
 */
export function App() {
  const services = useServices();

  const fileServices = useMemo<FileServices>(
    () => ({
      files: services.files,
      fileTree: services.fileTree,
      blobs: services.blobs,
      packages: services.packages,
      packageList: services.packageList,
      onError: services.reportError,
    }),
    [services]
  );

  const graphServices = useMemo<GraphServices>(
    () => ({
      graph: services.graph,
      commands: services.graphCommands,
      spaceId: services.identity.spaceId,
      userId: services.identity.userId,
      onError: services.reportError,
    }),
    [services]
  );

  return (
    <GraphServicesProvider services={graphServices}>
      <FileServicesProvider services={fileServices}>
        <FileSelectionProvider>
          <Workbench />
        </FileSelectionProvider>
      </FileServicesProvider>
    </GraphServicesProvider>
  );
}

function Workbench() {
  const services = useServices();
  const { setOpenFileId } = useFileSelection();
  const palette = useCommandPalette();
  const t = useWorkbenchTranslator();
  const fileLabels: FileExplorerLabels = useMemo(
    () => (t ? buildFileExplorerLabels(t) : defaultFileExplorerLabels),
    [t]
  );
  const paletteLabels: CommandPaletteLabels = useMemo(
    () => (t ? buildCommandPaletteLabels(t) : defaultCommandPaletteLabels),
    [t]
  );

  // A document is created through the document port and opened by the
  // file node the port lists it under — the explorer resolves the node.
  const documents = useMemo<DocumentActions>(
    () => ({
      async create({ title, parentId }) {
        const result = await services.documents.create({ title, parentId });
        if (result.isErr()) {
          services.reportError(result.error);
          return null;
        }
        return { id: result.value.id };
      },
    }),
    [services]
  );

  const paletteHandlers = useMemo<CommandPaletteHandlers>(
    () => ({
      onOpenFolder: (nodeId) => setOpenFileId(nodeId),
      onOpenDocument: (nodeId) => setOpenFileId(nodeId),
      onInspect: (node) => setOpenFileId(node.id),
    }),
    [setOpenFileId]
  );

  return (
    <div className="bg-background text-foreground flex h-full flex-col">
      <WorkbenchChrome
        brand="ProFlow"
        tabLabel="Drive"
        note={{
          label: 'Local-first',
          text: 'Documents and files are stored on this device and open without a network.',
        }}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => palette.setOpen(true)}
            data-testid="command-palette-trigger"
          >
            <Search aria-hidden />
            Search
            <kbd className="text-muted-foreground ml-1 text-[10px]">⌘K</kbd>
          </Button>
        }
      />
      <WorkbenchShell
        panel={{
          kind: 'fixed',
          width: SIDEBAR_WIDTH,
          'aria-label': 'Files',
          className: 'p-0',
          children: <FileExplorer documents={documents} labels={fileLabels} />,
        }}
        main={
          <FilePane
            className="h-full"
            labels={fileLabels}
            renderDocument={(document: DocumentMeta) => (
              <DocumentPane document={document} />
            )}
          />
        }
        className="min-h-0 flex-1"
      />
      <CommandPalette
        labels={paletteLabels}
        handlers={paletteHandlers}
        state={palette}
      />
    </div>
  );
}
