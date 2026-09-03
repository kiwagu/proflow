'use client';

import type { FileNode } from '@workspace/domain';
import { useWatch } from '@workspace/persistence-pglite/react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useFileTree, usePackageList } from './file-services.js';

/**
 * Which node the explorer has selected. The pane renders whatever it is —
 * the editor for a native document, a viewer for anything else — so the
 * selection is shared state between two sibling surfaces rather than a
 * prop either of them owns.
 */
export interface FileSelection {
  openFileId: string | undefined;
  setOpenFileId: (id: string | undefined) => void;
}

const FileSelectionContext = createContext<FileSelection | null>(null);

export function FileSelectionProvider(props: {
  children: ReactNode;
  /** Selection to start from; useful when a route already names a file. */
  initialOpenFileId?: string;
}) {
  const [openFileId, setOpenFileId] = useState<string | undefined>(
    props.initialOpenFileId
  );
  const value = useMemo(
    () => ({ openFileId, setOpenFileId }),
    [openFileId, setOpenFileId]
  );
  return (
    <FileSelectionContext.Provider value={value}>
      {props.children}
    </FileSelectionContext.Provider>
  );
}

export function useFileSelection(): FileSelection {
  const selection = useContext(FileSelectionContext);
  if (!selection)
    throw new Error(
      'useFileSelection must be used within <FileSelectionProvider />'
    );
  return selection;
}

/** Stable empty deliveries — a fresh literal would resubscribe every render. */
const NO_NODES: FileNode[] = [];
const NO_HASHES: string[] = [];

/** The whole tree, flat, refreshed on every change. */
export function useFileNodes(): FileNode[] {
  const tree = useFileTree();
  const watch = useCallback(
    (cb: (nodes: FileNode[]) => void) => tree.watchAll(cb),
    [tree]
  );
  return useWatch(watch, NO_NODES);
}

/**
 * Which archives are unpacked. One live list for the whole tree: a
 * question per row would be a query per row, on a connection that already
 * serves the editor.
 */
export function useUnpackedHashes(): Set<string> {
  const packageList = usePackageList();
  const watch = useCallback(
    (cb: (hashes: string[]) => void) =>
      packageList ? packageList.watchUnpacked(cb) : () => {},
    [packageList]
  );
  const hashes = useWatch(watch, NO_HASHES);
  return useMemo(() => new Set(hashes), [hashes]);
}
