'use client';

import * as React from 'react';

import { useEditLauncher } from '../views/document-reader/use-edit-launcher';

/**
 * The dual-pane (Dolphin-style split) + document-reader launcher for the Drive workbench.
 *
 * Dual-pane — KB-browse only. The SECOND pane is EPHEMERAL: it shares the first pane's ONE
 * sidebar (renders sidebar-less), is always KB-browse, and its folder location is LOCAL
 * (not URL-mirrored — only the primary is shareable). Opening mirrors the primary pane's
 * current folder, then the two diverge independently. Selection (Details) + the document
 * reader stay SHARED across both panes.
 *
 * The reader's "edit this document" launcher (seed-choice flow + chooser) is the ONE
 * launcher shared by the reader's Edit button and the `⋯` context menus on cards/panel.
 */
export function useDriveSplitReader({
  spaceId,
  messages,
  primaryFolderId,
  recordOpen,
}: {
  spaceId: string | undefined;
  messages: Record<string, string>;
  primaryFolderId: string | null;
  recordOpen: (nodeId: string) => void;
}) {
  const [split, setSplit] = React.useState(false);
  const [folderId2, setFolderId2] = React.useState<string | null>(null);

  // Second pane — folder navigation only, LOCAL (no URL): the ephemeral split view.
  const goFolder2 = React.useCallback(
    (id: string | null) => {
      setFolderId2(id);
      if (id) {
        recordOpen(id);
      }
    },
    [recordOpen]
  );

  // Toggle the split. Opening mirrors the primary pane's current folder, then the two
  // diverge independently.
  const toggleSplit = React.useCallback(() => {
    if (!split) {
      setFolderId2(primaryFolderId);
    }
    setSplit((on) => !on);
  }, [split, primaryFolderId]);

  // The ONE "edit this document" launcher (seed-choice flow + chooser), shared by
  // the reader's Edit button and the `⋯` context menus on cards and the panel.
  const { requestEdit, chooser, preparingEdit } = useEditLauncher({
    spaceId: spaceId ?? '',
    messages,
  });

  return {
    split,
    setSplit,
    folderId2,
    goFolder2,
    toggleSplit,
    requestEdit,
    chooser,
    preparingEdit,
  };
}
