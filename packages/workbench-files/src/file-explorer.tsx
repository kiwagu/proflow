'use client';

import { type FileNode, newId } from '@workspace/domain';
import { Button } from '@workspace/ui/components/button';
import { Hint } from '@workspace/ui/components/hint';
import { ScrollArea } from '@workspace/ui/components/scroll-area';
import { hotkeyLabel } from '@workspace/ui/hooks/hotkey-label';
import { useHotkey } from '@workspace/ui/hooks/use-hotkey';
import { FilePlus, FolderPlus, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CollapsibleSection } from './collapsible-section.js';
import { FileRow, PendingRow } from './file-row.js';
import {
  useFiles,
  useMay,
  usePackages,
  useReportError,
} from './file-services.js';
import {
  defaultFileExplorerLabels,
  type FileExplorerLabels,
} from './labels.js';
import {
  useFileNodes,
  useFileSelection,
  useUnpackedHashes,
} from './file-selection.js';
import {
  ancestorsOf,
  buildTree,
  moveTargetsFor,
  type PendingImport,
  pendingToShow,
  type TreeItem,
} from './file-tree.js';
import {
  documentTitleOf,
  isMarkdownFile,
  MarkdownEncodingError,
  readMarkdownText,
} from './markdown-file.js';
import { useFileDrop } from './use-file-drop.js';

/**
 * A document surface the explorer can create into and prefetch from.
 *
 * Optional because the tree is meaningful without an editor behind it —
 * a host that only stores files gets the same explorer minus the "new
 * document" affordance, rather than a broken button.
 */
export interface DocumentActions {
  create: (input: {
    title: string;
    parentId: string | null;
  }) => Promise<{ id: string } | null>;
  /** Warms the cache for a document about to be opened. Best-effort. */
  prefetch?: (documentId: string) => void;
  /**
   * Makes a document out of markdown text. Absent, a markdown file is stored
   * as an attachment like any other, so a host without an editor still keeps
   * the bytes.
   */
  importMarkdown?: (input: {
    name: string;
    text: string;
    parentId: string | null;
  }) => Promise<{ id: string } | null>;
  /** Hands the document to the user as a portable markdown download. */
  exportMarkdown?: (documentId: string) => Promise<void>;
}

/**
 * The keystroke that creates a document, exported so the hint on the toolbar
 * button renders from the same description the binding is registered with.
 *
 * ⌘J / Ctrl+J rather than the ⌘N this obviously wants: Chromium RESERVES the
 * new-window, new-tab and new-incognito-window accelerators, so ⌘N, ⌘T and ⌘⇧N
 * never reach a page at all and binding one would produce a shortcut that
 * silently does nothing. ⌘J is delivered to the page and is what the user gets.
 */
export const NEW_DOCUMENT_HOTKEY = { key: 'j', mod: true } as const;

/**
 * The explorer: every file the user has, in one tree. Folders group;
 * native documents and imported files sit side by side. The Documents
 * section below is the same data filtered — a flat, recent-first view.
 */
export function FileExplorer({
  documents,
  recentDocumentLimit = 20,
  labels = defaultFileExplorerLabels,
}: {
  documents?: DocumentActions;
  recentDocumentLimit?: number;
  labels?: FileExplorerLabels;
}) {
  const files = useFiles();
  const may = useMay();
  const mayCreate = may('node.create', null);
  const packages = usePackages();
  const reportError = useReportError();
  const { openFileId, setOpenFileId } = useFileSelection();
  const nodes = useFileNodes();
  // Trashing a folder trashes what it holds, so it is offered only when
  // every node in it that this person can see may be trashed by them too:
  // one walk up from each node they may not trash marks every folder above it.
  const holdsUntrashable = new Set<string>();
  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));
  for (const n of nodes) {
    if (may('node.trash', n)) continue;
    for (
      let up = parentOf.get(n.id) ?? null;
      up !== null && !holdsUntrashable.has(up);
      up = parentOf.get(up) ?? null
    )
      holdsUntrashable.add(up);
  }
  const mayTrash = (node: FileNode) =>
    may('node.trash', node) && !holdsUntrashable.has(node.id);
  const unpackedHashes = useUnpackedHashes();

  // Hovering a document row warms the client cache: by the time the click
  // lands, the content is usually already in memory and the open is
  // render-only. Fire-and-forget on purpose — a miss costs nothing.
  const prefetched = useRef(new Set<string>());
  const prefetch = (documentId: string | null) => {
    if (!documentId || prefetched.current.has(documentId)) return;
    prefetched.current.add(documentId);
    documents?.prefetch?.(documentId);
  };
  // Only a document row exports, and only when the host can render one.
  const exportFor = (node: FileNode): (() => void) | undefined => {
    const exportMarkdown = documents?.exportMarkdown;
    const documentId = node.documentId;
    return exportMarkdown && documentId
      ? () => void exportMarkdown(documentId)
      : undefined;
  };

  const isUnpacked = (node: FileNode) =>
    node.blobHash ? unpackedHashes.has(node.blobHash) : undefined;
  // Unpacking and throwing the unpacked files away are the two things a
  // user can do to an archive as a file, rather than as the thing inside
  // it — so they belong in its row, not only in the viewer that opens it.
  const unpack = async (node: FileNode) => {
    if (!node.blobHash || !packages) return;
    const result = await packages.importArchive(node.blobHash);
    if (result.isErr()) reportError(labels.errors.unpack(result.error));
  };
  const discardUnpacked = async (node: FileNode) => {
    if (!node.blobHash || !packages) return;
    const result = await packages.discardUnpacked(node.blobHash);
    if (result.isErr())
      reportError(labels.errors.discardUnpacked(result.error));
  };

  // Files in flight show as rows where they will land, with their
  // progress; the real row replaces the placeholder when the bytes are in.
  // The placeholder carries the id the node will have, so the swap happens
  // the moment the tree delivers it rather than whenever the import call
  // gets around to returning.
  const [pending, setPending] = useState<PendingImport[]>([]);
  const importing = useMemo(
    () => pendingToShow(pending, nodes),
    [pending, nodes]
  );
  // A file being imported is listed among the stored ones, in the place
  // it will keep: a row that appears at the bottom and jumps elsewhere
  // when the bytes land reads as two different events.
  const items = useMemo(() => buildTree(nodes, importing), [nodes, importing]);
  const recentDocuments = useMemo(
    () =>
      nodes
        .filter((n) => n.kind === 'document')
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .slice(0, recentDocumentLimit),
    [nodes, recentDocumentLimit]
  );

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  /** Expands every folder above `id` — and `id` itself when it is a folder. */
  const reveal = useCallback(
    (id: string, from: readonly FileNode[]) =>
      setExpanded((prev) => {
        const next = new Set([...prev, ...ancestorsOf(from, id)]);
        if (from.find((n) => n.id === id)?.kind === 'folder') next.add(id);
        return next;
      }),
    []
  );

  // Where a new thing goes: the selected folder, or the folder of the
  // selected file. The root otherwise.
  const targetFolder = (): string | null => {
    const current = nodes.find((n) => n.id === openFileId);
    if (!current) return null;
    return current.kind === 'folder' ? current.id : current.parentId;
  };

  const open = (node: FileNode) => {
    pick(node.id);
    if (node.kind === 'folder') toggle(node.id);
  };

  // A document is created through the document surface, and its file node
  // arrives separately through the live tree. Selecting it therefore has
  // to wait for that delivery — remembering which document to select and
  // reacting when it lands, rather than polling for it. The ref holds WHICH
  // document is awaited; the counter says THAT it changed, because the node
  // may land BEFORE the surface answers (an optimistic tree publishes it
  // while the content is still being written) and the match below must run
  // again when the answer then arrives, not only when the tree moves.
  const awaiting = useRef<string | undefined>(undefined);
  const [awaitingChanged, setAwaitingChanged] = useState(0);
  // Every change of the selection, whoever made it — a pick by hand, the last
  // file of a batch, the palette — outranks a document still waiting on its
  // node, so the wait ends here. The generation lets an operation that was
  // already running when the user picked (its answer not in yet) see that it
  // has been outranked and not start a wait of its own. Declared before the
  // match below so that a pick and the awaited node landing in one commit
  // resolve in the user's favour.
  const selectionGeneration = useRef(0);
  // A selection this surface makes FOR the user — an import that opens
  // itself, the next file of a batch — carries no intent of theirs, so it
  // must not count as a pick against the operations still answering; the id
  // is remembered so the effect below can tell it from the user's own.
  const ownSelection = useRef<string | undefined>(undefined);
  // The selection as last committed, for the async paths below: their
  // closures may hold an older render's value.
  const latestOpenFileId = useRef(openFileId);
  useEffect(() => {
    // Whatever transition this is, it consumes the marker: a marker that
    // outlived its own transition would later disguise a pick by the user.
    const own = ownSelection.current;
    ownSelection.current = undefined;
    latestOpenFileId.current = openFileId;
    if (openFileId !== undefined && openFileId === own) return;
    selectionGeneration.current += 1;
    awaiting.current = undefined;
  }, [openFileId]);
  /**
   * Marks the transition an automatic selection is about to cause. A
   * selection that changes nothing — the id already committed, or a batch of
   * automatic selections that ends where it started — causes no transition
   * and so no effect to consume a marker: it must leave none behind, or the
   * user's next real pick of that file would pass for ours.
   */
  const markOwn = (id: string) => {
    ownSelection.current = id === latestOpenFileId.current ? undefined : id;
  };
  useEffect(() => {
    const documentId = awaiting.current;
    if (!documentId) return;
    const node = nodes.find((n) => n.documentId === documentId);
    if (!node) return;
    awaiting.current = undefined;
    markOwn(node.id);
    setOpenFileId(node.id);
    reveal(node.id, nodes);
  }, [nodes, awaitingChanged, setOpenFileId, reveal]);
  /** Waits for `documentId`'s node — unless the user picked something since `generation`. */
  const awaitDocumentSince = (documentId: string, generation: number) => {
    if (selectionGeneration.current !== generation) return;
    awaiting.current = documentId;
    setAwaitingChanged((n) => n + 1);
  };
  /** The latest import wins: selecting it ends whatever an earlier one still waited for. */
  const selectAutomatically = (id: string) => {
    awaiting.current = undefined;
    markOwn(id);
    setOpenFileId(id);
  };
  /** A pick by the user, counted even when it names the file already open. */
  const pick = (id: string) => {
    selectionGeneration.current += 1;
    awaiting.current = undefined;
    ownSelection.current = undefined;
    setOpenFileId(id);
  };

  const createDocument = async () => {
    if (!documents) return;
    const parentId = targetFolder();
    const generation = selectionGeneration.current;
    const created = await documents.create({ title: 'Untitled', parentId });
    if (!created) return;
    awaitDocumentSince(created.id, generation);
  };

  /**
   * The keyboard route to the same action as the toolbar button — one
   * `createDocument`, two ways to reach it.
   *
   * Registered only when there is a document surface to create into, so a host
   * that only stores files leaves the keystroke to the browser instead of
   * swallowing it for an affordance it does not have.
   */
  useHotkey(NEW_DOCUMENT_HOTKEY, () => void createDocument(), {
    enabled: Boolean(documents) && mayCreate,
  });

  const createFolder = async () => {
    const parentId = targetFolder();
    const created = await files.createFolder({
      parentId,
      name: labels.newFolderName,
    });
    if (created.isOk()) {
      setOpenFileId(created.value.id);
      if (parentId) reveal(parentId, nodes);
    } else reportError(labels.errors.createFolder(created.error));
  };

  // Not memoized: the helpers it calls are plain functions of this render,
  // and the drop hook re-binds its handlers on every callback change anyway.
  const importFiles = async (list: File[], parentId: string | null) => {
    if (parentId) reveal(parentId, nodes);
    for (const file of list) {
      // A markdown file becomes a document, not bytes: there is no upload
      // to show the progress of, so it never gets a placeholder row, and
      // it is selected the way a new document is — once its node arrives.
      if (documents?.importMarkdown && isMarkdownFile(file)) {
        const generation = selectionGeneration.current;
        try {
          const text = await readMarkdownText(file);
          const created = await documents.importMarkdown({
            name: documentTitleOf(file.name) || labels.row.untitled,
            text,
            parentId,
          });
          if (created) awaitDocumentSince(created.id, generation);
        } catch (e) {
          reportError(
            e instanceof MarkdownEncodingError
              ? labels.errors.importEncoding(file.name)
              : labels.errors.import(file.name, String(e))
          );
        }
        continue;
      }
      const id = newId('knowledgeResource');
      setPending((prev) => [
        ...prev,
        { id, name: file.name, parentId, progress: 0 },
      ]);
      try {
        const result = await files.importFile({
          id,
          parentId,
          name: file.name,
          blob: file,
          onProgress: (done, total) =>
            setPending((prev) =>
              prev.map((p) =>
                p.id === id ? { ...p, progress: total ? done / total : 0 } : p
              )
            ),
        });
        if (result.isOk()) selectAutomatically(result.value.id);
        else reportError(labels.errors.import(file.name, result.error));
      } catch (e) {
        reportError(labels.errors.import(file.name, String(e)));
      } finally {
        setPending((prev) => prev.filter((p) => p.id !== id));
      }
    }
  };

  const picker = useRef<HTMLInputElement>(null);
  // A drop lands where the pointer is, not where the selection is: the
  // target folder is read at drop time, so a drop on the empty tree with
  // a file selected still imports beside it.
  const onDropped = (list: File[]) => {
    if (!mayCreate) return;
    const current = nodes.find((n) => n.id === openFileId);
    const parentId = !current
      ? null
      : current.kind === 'folder'
        ? current.id
        : current.parentId;
    void importFiles(list, parentId);
  };
  const { dragging, handlers } = useFileDrop(onDropped);

  const renderRows = (
    treeItems: TreeItem[],
    depth: number
  ): React.ReactNode[] =>
    treeItems.map((item, index) => {
      if (item.row === 'importing')
        return (
          <PendingRow
            key={`importing:${item.file.id}`}
            name={item.file.name}
            progress={item.file.progress}
            depth={depth}
          />
        );
      const node = item.node;
      return (
        <div key={node.id || `row:${index}`}>
          <FileRow
            node={node}
            depth={depth}
            active={openFileId === node.id}
            expanded={expanded.has(node.id)}
            onToggle={() => toggle(node.id)}
            onOpen={() => open(node)}
            onRename={
              may('node.update', node)
                ? (name) => void files.rename(node.id, name)
                : undefined
            }
            onDelete={
              mayTrash(node)
                ? () => {
                    if (openFileId === node.id) setOpenFileId(undefined);
                    void files.softDelete(node.id);
                  }
                : undefined
            }
            onStar={
              may('node.star', node)
                ? (starred) => void files.setStarred(node.id, starred)
                : undefined
            }
            unpacked={isUnpacked(node)}
            onUnpack={packages ? () => void unpack(node) : undefined}
            onDiscardUnpacked={
              packages ? () => void discardUnpacked(node) : undefined
            }
            onApproach={() => prefetch(node.documentId)}
            onExport={exportFor(node)}
            moveTargets={
              may('node.move', node)
                ? moveTargetsFor(nodes, node.id)
                : undefined
            }
            onMove={
              may('node.move', node)
                ? (parentId) => {
                    void files.move(node.id, parentId);
                    if (parentId) reveal(parentId, nodes);
                  }
                : undefined
            }
            labels={labels}
          />
          {node.kind === 'folder' && expanded.has(node.id)
            ? renderRows(item.children, depth + 1)
            : null}
        </div>
      );
    });

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      data-testid="file-explorer"
      {...handlers}
    >
      <div className="flex items-center gap-0.5 px-2 pt-2 pb-1">
        {documents && mayCreate ? (
          <Hint
            label={labels.newDocument}
            keys={hotkeyLabel(NEW_DOCUMENT_HOTKEY)}
          >
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={labels.newDocument}
              data-testid="new-document"
              onClick={() => void createDocument()}
            >
              <FilePlus className="size-4" />
            </Button>
          </Hint>
        ) : null}
        {mayCreate ? (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              title={labels.newFolder}
              aria-label={labels.newFolder}
              data-testid="new-folder"
              onClick={() => void createFolder()}
            >
              <FolderPlus className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title={labels.uploadFiles}
              aria-label={labels.uploadFiles}
              data-testid="upload-files"
              onClick={() => picker.current?.click()}
            >
              <Upload className="size-4" />
            </Button>
            <input
              ref={picker}
              type="file"
              multiple
              className="hidden"
              aria-label={labels.uploadFiles}
              data-testid="file-input"
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []);
                e.target.value = '';
                void importFiles(list, targetFolder());
              }}
            />
          </>
        ) : null}
        {importing.length > 0 ? (
          <span
            className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums"
            data-testid="importing"
          >
            {labels.importing(importing.length)}
          </span>
        ) : null}
      </div>
      <ScrollArea className="min-h-0 flex-1 px-2 pb-2">
        <div className="flex flex-col gap-3">
          <CollapsibleSection
            label={labels.sectionFiles}
            persistKey="files"
            testId="files-section"
          >
            {items.length > 0 || importing.length > 0 ? (
              renderRows(items, 0)
            ) : (
              <p className="text-muted-foreground px-2 py-1 text-xs">
                {labels.empty}
              </p>
            )}
          </CollapsibleSection>
          <CollapsibleSection
            label={labels.sectionDocuments}
            persistKey="documents"
            testId="documents-section"
          >
            {recentDocuments.map((node) => (
              <FileRow
                key={node.id}
                node={node}
                depth={0}
                active={openFileId === node.id}
                onOpen={() => {
                  setOpenFileId(node.id);
                  reveal(node.id, nodes);
                }}
                onRename={
                  may('node.update', node)
                    ? (name) => void files.rename(node.id, name)
                    : undefined
                }
                onDelete={
                  mayTrash(node)
                    ? () => {
                        if (openFileId === node.id) setOpenFileId(undefined);
                        void files.softDelete(node.id);
                      }
                    : undefined
                }
                onStar={
                  may('node.star', node)
                    ? (starred) => void files.setStarred(node.id, starred)
                    : undefined
                }
                onApproach={() => prefetch(node.documentId)}
                onExport={exportFor(node)}
                labels={labels}
              />
            ))}
          </CollapsibleSection>
        </div>
      </ScrollArea>
      {dragging ? (
        <div
          className="border-primary/40 bg-background/80 pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl border-2 border-dashed"
          data-testid="file-drop-overlay"
        >
          <div className="border-border bg-background text-foreground flex items-center gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg">
            <Upload className="size-4 shrink-0" />
            {labels.dropToImport}
          </div>
        </div>
      ) : null}
    </div>
  );
}
