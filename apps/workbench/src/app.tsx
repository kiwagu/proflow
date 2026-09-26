import type { DocumentMeta } from '@workspace/domain';
import { Button } from '@workspace/ui/components/button';
import { Hint } from '@workspace/ui/components/hint';
import { WorkbenchChrome } from '@workspace/ui/components/platform/workbench-chrome';
import { TooltipProvider } from '@workspace/ui/components/tooltip';
import { WorkbenchShell } from '@workspace/ui/components/workbench-shell';
import { hotkeyLabel } from '@workspace/ui/hooks/hotkey-label';
import { useHotkey } from '@workspace/ui/hooks/use-hotkey';
import {
  buildFileExplorerLabels,
  defaultFileExplorerLabels,
  FileExplorer,
  FilePane,
  FileSelectionProvider,
  FileServicesProvider,
  useFileNodes,
  useFileSelection,
  type DocumentActions,
  type FileExplorerLabels,
  type FileServices,
} from '@workspace/workbench-files';
import {
  buildCommandPaletteLabels,
  CommandPalette,
  COMMAND_PALETTE_HOTKEY,
  defaultCommandPaletteLabels,
  GraphServicesProvider,
  useCommandPalette,
  type CommandPaletteHandlers,
  type CommandPaletteLabels,
  type GraphServices,
  type PaletteCommand,
} from '@workspace/workbench-graph';
import { useMaybeAgent } from '@workspace/workbench-agent';
import {
  buildHistoryLabels,
  defaultHistoryLabels,
  type HistoryLabels,
} from '@workspace/workbench-editor';
import { History, MessageSquare, Search, Trash2 } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useServices } from './composition/app-services';
import {
  CHAT_PANEL_HOTKEY,
  CHAT_PANEL_WIDTH,
} from './features/chat/chat.constants';
import { ChatPanelContainer } from './features/chat/chat.container';
import {
  buildChatPanelLabels,
  defaultChatPanelLabels,
  type ChatPanelLabels,
} from './features/chat/chat.labels';
import { DocumentPane } from './features/document-pane';
import { DocumentRevisionProvider } from './features/document-revision';
import {
  HISTORY_PANEL_HOTKEY,
  HISTORY_PANEL_WIDTH,
} from './features/history/history.constants';
import { HistoryPanelContainer } from './features/history/history.container';
import { TrashPanel } from './features/trash/trash.panel';
import { useWorkbenchTranslator } from './i18n';
import { useAside } from './shell/aside';
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
    // One provider per app root — Radix's canonical shape, and what `Hint`
    // requires. Every hint in the workbench shares its open/skip delay, so a
    // sweep across neighbouring controls opens instantly.
    <TooltipProvider>
      <GraphServicesProvider services={graphServices}>
        <FileServicesProvider services={fileServices}>
          <FileSelectionProvider>
            {/* The history panel and the editor pane are siblings, so the
                fact that a restore rewrote the open document has to be
                shared above both of them. */}
            <DocumentRevisionProvider>
              <Workbench />
            </DocumentRevisionProvider>
          </FileSelectionProvider>
        </FileServicesProvider>
      </GraphServicesProvider>
    </TooltipProvider>
  );
}

function Workbench() {
  const services = useServices();
  const { openFileId, setOpenFileId } = useFileSelection();
  const nodes = useFileNodes();
  const palette = useCommandPalette();
  const t = useWorkbenchTranslator();
  // The assistant is offered only when the page actually started a worker;
  // an environment without one is a working editor, not a broken app.
  const agent = useMaybeAgent();
  // The shell has ONE right-hand region, so the assistant and the history are
  // alternatives: opening either closes the other, by construction.
  const aside = useAside();
  // The history is a document's history; with none open there is nothing to
  // show, so neither the trigger nor the shortcut exists.
  const openDocumentId =
    nodes.find((node) => node.id === openFileId)?.documentId ?? null;
  useHotkey(CHAT_PANEL_HOTKEY, () => aside.toggle('chat'), {
    enabled: agent !== null,
  });
  useHotkey(HISTORY_PANEL_HOTKEY, () => aside.toggle('history'), {
    enabled: openDocumentId !== null,
  });
  const fileLabels: FileExplorerLabels = useMemo(
    () => (t ? buildFileExplorerLabels(t) : defaultFileExplorerLabels),
    [t]
  );
  const paletteLabels: CommandPaletteLabels = useMemo(
    () => (t ? buildCommandPaletteLabels(t) : defaultCommandPaletteLabels),
    [t]
  );
  const chatLabels: ChatPanelLabels = useMemo(
    () => (t ? buildChatPanelLabels(t) : defaultChatPanelLabels),
    [t]
  );
  const historyLabels: HistoryLabels = useMemo(
    () => (t ? buildHistoryLabels(t) : defaultHistoryLabels),
    [t]
  );

  /**
   * The document as portable markdown, handed to the browser as a download.
   *
   * The headless editor and its transformers are the editor's weight, so
   * they load with the first export rather than with the app — the same way
   * the editor pane itself does.
   */
  const exportMarkdown = useCallback(
    async (documentId: string) => {
      const [{ exportDocumentMarkdown }, { downloadText }] = await Promise.all([
        import('./features/document-markdown'),
        import('./features/download'),
      ]);
      const result = await exportDocumentMarkdown(
        services.documents,
        documentId
      );
      if (result.isErr()) {
        services.reportError(result.error);
        return;
      }
      downloadText(
        `${result.value.title}.md`,
        result.value.markdown,
        'text/markdown'
      );
    },
    [services]
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
      async importMarkdown({ name, text, parentId }) {
        const { importMarkdownDocument } =
          await import('./features/document-markdown');
        const result = await importMarkdownDocument(
          services.documents,
          { user: services.identity.userId, src: 'human' },
          { name, text, parentId }
        );
        if (result.isErr()) {
          services.reportError(result.error);
          return null;
        }
        return { id: result.value.id };
      },
      exportMarkdown,
    }),
    [services, exportMarkdown]
  );

  // What the palette can do, beyond finding: the open document's export.
  const paletteCommands = useMemo<PaletteCommand[]>(
    () =>
      openDocumentId
        ? [
            {
              id: 'export-markdown',
              label: t
                ? t('workbench.palette.command.exportMarkdown')
                : 'Export as Markdown',
              run: () => void exportMarkdown(openDocumentId),
            },
          ]
        : [],
    [openDocumentId, exportMarkdown, t]
  );

  const paletteHandlers = useMemo<CommandPaletteHandlers>(
    () => ({
      onOpenFolder: (nodeId) => setOpenFileId(nodeId),
      onOpenDocument: (nodeId) => setOpenFileId(nodeId),
      onInspect: (node) => setOpenFileId(node.id),
    }),
    [setOpenFileId]
  );

  /**
   * The one right-hand region, resolved from the single aside state. Two
   * panels, one slot: a closed companion surface costs no layout at all,
   * which is why the shell takes an absent descriptor rather than a hidden
   * one. The assistant's region also disappears when its worker does.
   */
  const asideRegion = useMemo(() => {
    if (aside.open === 'trash')
      return {
        kind: 'fixed' as const,
        width: HISTORY_PANEL_WIDTH,
        'aria-label': t ? t('workbench.trash.title') : 'Trash',
        children: <TrashPanel />,
      };
    if (aside.open === 'chat' && agent)
      return {
        kind: 'fixed' as const,
        width: CHAT_PANEL_WIDTH,
        'aria-label': chatLabels.ariaLabel,
        children: <ChatPanelContainer labels={chatLabels} />,
      };
    if (aside.open === 'history' && openDocumentId)
      return {
        kind: 'fixed' as const,
        width: HISTORY_PANEL_WIDTH,
        'aria-label': historyLabels.ariaLabel,
        children: (
          <HistoryPanelContainer
            documentId={openDocumentId}
            labels={historyLabels}
          />
        ),
      };
    return undefined;
  }, [aside.open, agent, chatLabels, historyLabels, openDocumentId, t]);

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
          <>
            <Button
              variant={aside.open === 'trash' ? 'secondary' : 'outline'}
              size="sm"
              aria-pressed={aside.open === 'trash'}
              onClick={() => aside.toggle('trash')}
              data-testid="trash-panel-trigger"
            >
              <Trash2 aria-hidden />
              {t ? t('workbench.trash.title') : 'Trash'}
            </Button>
            {agent ? (
              <Hint
                label={t ? t('workbench.chat.toggle') : 'Assistant'}
                keys={hotkeyLabel(CHAT_PANEL_HOTKEY)}
              >
                <Button
                  variant={aside.open === 'chat' ? 'secondary' : 'outline'}
                  size="sm"
                  aria-pressed={aside.open === 'chat'}
                  aria-label={t ? t('workbench.chat.toggle') : 'Assistant'}
                  onClick={() => aside.toggle('chat')}
                  data-testid="chat-panel-trigger"
                >
                  <MessageSquare aria-hidden />
                  {t ? t('workbench.chat.toggle') : 'Assistant'}
                </Button>
              </Hint>
            ) : null}
            {openDocumentId ? (
              <Hint
                label={t ? t('workbench.history.toggle') : 'History'}
                keys={hotkeyLabel(HISTORY_PANEL_HOTKEY)}
              >
                <Button
                  variant={aside.open === 'history' ? 'secondary' : 'outline'}
                  size="sm"
                  aria-pressed={aside.open === 'history'}
                  aria-label={t ? t('workbench.history.toggle') : 'History'}
                  onClick={() => aside.toggle('history')}
                  data-testid="history-panel-trigger"
                >
                  <History aria-hidden />
                  {t ? t('workbench.history.toggle') : 'History'}
                </Button>
              </Hint>
            ) : null}
            <Hint
              label={t ? t('workbench.app.search') : 'Search'}
              keys={hotkeyLabel(COMMAND_PALETTE_HOTKEY)}
            >
              <Button
                variant="outline"
                size="sm"
                onClick={() => palette.setOpen(true)}
                data-testid="command-palette-trigger"
              >
                <Search aria-hidden />
                {t ? t('workbench.app.search') : 'Search'}
              </Button>
            </Hint>
          </>
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
        aside={asideRegion}
        className="min-h-0 flex-1"
      />
      <CommandPalette
        labels={paletteLabels}
        handlers={paletteHandlers}
        state={palette}
        commands={paletteCommands}
      />
    </div>
  );
}
