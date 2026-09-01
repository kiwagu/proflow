'use client';

import { type FileNode, newId } from '@workspace/domain';
import { Button } from '@workspace/ui/components/button';
import { ScrollArea } from '@workspace/ui/components/scroll-area';
import { FilePlus, FolderPlus, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CollapsibleSection } from './collapsible-section.js';
import { FileRow, PendingRow } from './file-row.js';
import { useFiles, usePackages, useReportError } from './file-services.js';
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
}

/**
 * The explorer: every file the user has, in one tree. Folders group;
 * native documents and imported files sit side by side. The Documents
 * section below is the same data filtered — a flat, recent-first view.
 */
export function FileExplorer({
  documents,
  recentDocumentLimit = 20,
}: {
  documents?: DocumentActions;
  recentDocumentLimit?: number;
}) {
  const files = useFiles();
  const packages = usePackages();
  const reportError = useReportError();
  const { openFileId, setOpenFileId } = useFileSelection();
  const nodes = useFileNodes();
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

  const isUnpacked = (node: FileNode) =>
    node.blobHash ? unpackedHashes.has(node.blobHash) : undefined;
  // Unpacking and throwing the unpacked files away are the two things a
  // user can do to an archive as a file, rather than as the thing inside
  // it — so they belong in its row, not only in the viewer that opens it.
  const unpack = async (node: FileNode) => {
    if (!node.blobHash || !packages) return;
    const result = await packages.importArchive(node.blobHash);
    if (result.isErr()) reportError(`Could not unpack: ${result.error}`);
  };
  const discardUnpacked = async (node: FileNode) => {
    if (!node.blobHash || !packages) return;
    const result = await packages.discardUnpacked(node.blobHash);
    if (result.isErr())
      reportError(`Could not delete the unpacked files: ${result.error}`);
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
    setOpenFileId(node.id);
    if (node.kind === 'folder') toggle(node.id);
  };

  // A document is created through the document surface, and its file node
  // arrives separately through the live tree. Selecting it therefore has
  // to wait for that delivery — remembering which document to select and
  // reacting when it lands, rather than polling for it.
  const awaiting = useRef<string | undefined>(undefined);
  useEffect(() => {
    const documentId = awaiting.current;
    if (!documentId) return;
    const node = nodes.find((n) => n.documentId === documentId);
    if (!node) return;
    awaiting.current = undefined;
    setOpenFileId(node.id);
    reveal(node.id, nodes);
  }, [nodes, setOpenFileId, reveal]);

  const createDocument = async () => {
    if (!documents) return;
    const parentId = targetFolder();
    const created = await documents.create({ title: 'Untitled', parentId });
    if (!created) return;
    awaiting.current = created.id;
  };

  const createFolder = async () => {
    const parentId = targetFolder();
    const created = await files.createFolder({ parentId, name: 'New folder' });
    if (created.isOk()) {
      setOpenFileId(created.value.id);
      if (parentId) reveal(parentId, nodes);
    } else reportError(`Could not create the folder: ${created.error}`);
  };

  const importFiles = useCallback(
    async (list: File[], parentId: string | null) => {
      if (parentId) reveal(parentId, nodes);
      for (const file of list) {
        const id = newId('fileNode');
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
          if (result.isOk()) setOpenFileId(result.value.id);
          else reportError(`Could not import ${file.name}: ${result.error}`);
        } catch (e) {
          reportError(`Could not import ${file.name}: ${String(e)}`);
        } finally {
          setPending((prev) => prev.filter((p) => p.id !== id));
        }
      }
    },
    [files, nodes, reveal, setOpenFileId, reportError]
  );

  const picker = useRef<HTMLInputElement>(null);
  // A drop lands where the pointer is, not where the selection is: the
  // target folder is read at drop time, so a drop on the empty tree with
  // a file selected still imports beside it.
  const onDropped = useCallback(
    (list: File[]) => {
      const current = nodes.find((n) => n.id === openFileId);
      const parentId = !current
        ? null
        : current.kind === 'folder'
          ? current.id
          : current.parentId;
      void importFiles(list, parentId);
    },
    [nodes, openFileId, importFiles]
  );
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
            onRename={(name) => void files.rename(node.id, name)}
            onDelete={() => {
              if (openFileId === node.id) setOpenFileId(undefined);
              void files.softDelete(node.id);
            }}
            onStar={(starred) => void files.setStarred(node.id, starred)}
            unpacked={isUnpacked(node)}
            onUnpack={packages ? () => void unpack(node) : undefined}
            onDiscardUnpacked={
              packages ? () => void discardUnpacked(node) : undefined
            }
            onApproach={() => prefetch(node.documentId)}
            moveTargets={moveTargetsFor(nodes, node.id)}
            onMove={(parentId) => {
              void files.move(node.id, parentId);
              if (parentId) reveal(parentId, nodes);
            }}
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
        {documents ? (
          <Button
            variant="ghost"
            size="icon-sm"
            title="New document"
            aria-label="New document"
            data-testid="new-document"
            onClick={() => void createDocument()}
          >
            <FilePlus className="size-4" />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          title="New folder"
          aria-label="New folder"
          data-testid="new-folder"
          onClick={() => void createFolder()}
        >
          <FolderPlus className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Upload files"
          aria-label="Upload files"
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
          aria-label="Upload files"
          data-testid="file-input"
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            e.target.value = '';
            void importFiles(list, targetFolder());
          }}
        />
        {importing.length > 0 ? (
          <span
            className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums"
            data-testid="importing"
          >
            {importing.length} importing
          </span>
        ) : null}
      </div>
      <ScrollArea className="min-h-0 flex-1 px-2 pb-2">
        <div className="flex flex-col gap-3">
          <CollapsibleSection
            label="Files"
            persistKey="files"
            testId="files-section"
          >
            {items.length > 0 || importing.length > 0 ? (
              renderRows(items, 0)
            ) : (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                Drop files here, or use the buttons above.
              </p>
            )}
          </CollapsibleSection>
          <CollapsibleSection
            label="Documents"
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
                onRename={(name) => void files.rename(node.id, name)}
                onDelete={() => {
                  if (openFileId === node.id) setOpenFileId(undefined);
                  void files.softDelete(node.id);
                }}
                onStar={(starred) => void files.setStarred(node.id, starred)}
                onApproach={() => prefetch(node.documentId)}
              />
            ))}
          </CollapsibleSection>
        </div>
      </ScrollArea>
      {dragging ? (
        <div
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-primary/40 bg-background/80"
          data-testid="file-drop-overlay"
        >
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground shadow-lg">
            <Upload className="size-4 shrink-0" />
            Drop to import
          </div>
        </div>
      ) : null}
    </div>
  );
}
