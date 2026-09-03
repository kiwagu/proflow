import type { DocumentMeta } from '@workspace/domain';
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
import { useMemo } from 'react';
import { useServices } from './composition/app-services';
import { DocumentPane } from './features/document-pane';
import { useWorkbenchTranslator } from './i18n';
import { SIDEBAR_WIDTH } from './shell/layout';

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
        brand={t ? t('workbench.app.brand') : 'ProFlow'}
        tabLabel={t ? t('workbench.app.tabLabel') : 'Drive'}
        note={{
          label: t ? t('workbench.app.localFirstLabel') : 'Local-first',
          text: t
            ? t('workbench.app.localFirstText')
            : 'Documents and files are stored on this device and open without a network.',
        }}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => palette.setOpen(true)}
            data-testid="command-palette-trigger"
          >
            <Search aria-hidden />
            {t ? t('workbench.app.search') : 'Search'}
            <kbd className="text-muted-foreground ml-1 text-[10px]">⌘K</kbd>
          </Button>
        }
      />
      <WorkbenchShell
        panel={{
          kind: 'fixed',
          width: SIDEBAR_WIDTH,
          'aria-label': t ? t('workbench.app.filesAriaLabel') : 'Files',
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
