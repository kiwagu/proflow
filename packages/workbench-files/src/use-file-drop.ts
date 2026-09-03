'use client';

import { useCallback, useRef, useState, type DragEvent } from 'react';

/**
 * Reads every file out of dropped entries, folders included.
 *
 * A dropped folder arrives as a directory entry whose reader hands out
 * children in batches, so the walk keeps asking until a batch comes back
 * empty — one short read is not the end of the directory.
 */
export async function filesOf(
  fileEntries: FileSystemFileEntry[],
  folderEntries: FileSystemDirectoryEntry[]
): Promise<File[]> {
  const files: File[] = [];
  const readFile = (entry: FileSystemFileEntry) =>
    new Promise<File>((res, rej) => entry.file(res, rej));
  const readDir = async (dir: FileSystemDirectoryEntry) => {
    const reader = dir.createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) =>
        reader.readEntries(res, rej)
      );
      if (batch.length === 0) break;
      for (const e of batch) {
        if (e.isFile) files.push(await readFile(e as FileSystemFileEntry));
        else if (e.isDirectory) await readDir(e as FileSystemDirectoryEntry);
      }
    }
  };
  for (const e of fileEntries) files.push(await readFile(e));
  for (const d of folderEntries) await readDir(d);
  return files;
}

/**
 * Splits a drop's items into files and directories.
 *
 * Preferring directories when both are present is deliberate: selecting a
 * folder AND its visible contents (an expanded list view) drops both, and
 * importing each separately would store every file twice.
 */
function entriesOf(transfer: DataTransfer): {
  fileEntries: FileSystemFileEntry[];
  directoryEntries: FileSystemDirectoryEntry[];
} {
  const fileEntries: FileSystemFileEntry[] = [];
  const directoryEntries: FileSystemDirectoryEntry[] = [];
  for (const item of Array.from(transfer.items)) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.();
    if (!entry) continue;
    if (entry.isDirectory)
      directoryEntries.push(entry as FileSystemDirectoryEntry);
    else fileEntries.push(entry as FileSystemFileEntry);
  }
  return { fileEntries, directoryEntries };
}

/** A plain File dressed as an entry, for browsers that hand back neither. */
function fileAsEntry(file: File): FileSystemFileEntry {
  return {
    file: (onSuccess: (f: File) => void) => onSuccess(file),
  } as FileSystemFileEntry;
}

export interface FileDropHandlers {
  onDragEnter: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}

/**
 * Drop-zone plumbing for files and folders.
 *
 * `dragging` is counted rather than toggled: dragging across a child
 * element fires leave-then-enter, and a boolean would flicker the overlay
 * off on every internal boundary crossed.
 */
export function useFileDrop(onFiles: (files: File[]) => void): {
  dragging: boolean;
  handlers: FileDropHandlers;
} {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  const onDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    depth.current += 1;
    if (Array.from(e.dataTransfer.items).some((i) => i.kind === 'file'))
      setDragging(true);
  }, []);

  const onDragOver = useCallback((e: DragEvent) => {
    // Without this the browser navigates to the dropped file instead.
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      depth.current = 0;
      setDragging(false);
      const transfer = e.dataTransfer;
      const { fileEntries, directoryEntries } = entriesOf(transfer);
      if (directoryEntries.length > 0) {
        void filesOf([], directoryEntries).then(onFiles);
        return;
      }
      if (fileEntries.length > 0) {
        void filesOf(fileEntries, []).then(onFiles);
        return;
      }
      const plain = Array.from(transfer.files);
      if (plain.length > 0)
        void filesOf(plain.map(fileAsEntry), []).then(onFiles);
    },
    [onFiles]
  );

  return {
    dragging,
    handlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}
