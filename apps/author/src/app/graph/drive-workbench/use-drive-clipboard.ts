'use client';

import * as React from 'react';

/**
 * The Dolphin-style clipboard for the Drive workbench — a node MARKED for copy by the `⋯`
 * "Copy" action. It is NOT an immediate write: a Paste affordance appears in each KB-browse
 * pane's toolbar and deep-copies the source into THAT pane's current folder. Persists after
 * a paste (multi-paste) until a new Copy replaces it (or Escape clears it).
 *
 * The SAME clipboard drives the second paste verb "Paste as shortcut": instead
 * of duplicating the source it creates a `shortcut` edge folder→source (a cross-folder
 * symlink — one canonical home, many appearances). A shortcut hangs off a FOLDER
 * (from_id = folder), so it is offered only INSIDE a folder, never at root.
 */
export function useDriveClipboard({
  spaceId,
  refresh,
}: {
  spaceId: string | undefined;
  refresh: () => void;
}) {
  const [clipboard, setClipboard] = React.useState<{
    sourceId: string;
    title: string;
  } | null>(null);

  const copyToClipboard = React.useCallback(
    (sourceId: string, title: string) => {
      setClipboard({ sourceId, title });
    },
    []
  );
  const clearClipboard = React.useCallback(() => setClipboard(null), []);

  // Escape clears the clipboard (Dolphin parity) — a clear, always-available exit.
  React.useEffect(() => {
    if (!clipboard) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setClipboard(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clipboard]);

  // PASTE — deep-copy the clipboard source into a folder (null → top level). The VIEW
  // builds the "X (copy)" rootTitle (it owns `t`); here we just POST under the user's
  // RLS, then re-resolve. Clipboard persists for further pastes.
  const pasteInto = React.useCallback(
    (targetFolderId: string | null, rootTitle: string) => {
      if (!spaceId || !clipboard) {
        return;
      }
      void fetch('/author/graph/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spaceId,
          sourceId: clipboard.sourceId,
          targetFolderId,
          rootTitle,
        }),
      }).then((res) => {
        if (res.ok) {
          refresh();
        }
      });
    },
    [spaceId, clipboard, refresh]
  );

  // PASTE AS SHORTCUT — place a `shortcut` edge from `targetFolderId` to the clipboard
  // source, the cross-folder symlink gesture. Folder-only by construction
  // (from_id = folder); the caller only offers it inside a folder. Clipboard persists so
  // the same source can be shortcutted into several folders. RLS is the sole write fence
  // (`space.knowledge.create` on the edge) — a reader's attempt fails cleanly.
  const pasteAsShortcutInto = React.useCallback(
    (targetFolderId: string) => {
      if (!spaceId || !clipboard) {
        return;
      }
      void fetch('/author/graph/edges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'shortcut',
          spaceId,
          folderId: targetFolderId,
          targetId: clipboard.sourceId,
        }),
      }).then((res) => {
        if (res.ok) {
          refresh();
        }
      });
    },
    [spaceId, clipboard, refresh]
  );

  return {
    clipboard,
    copyToClipboard,
    clearClipboard,
    pasteInto,
    pasteAsShortcutInto,
  };
}
