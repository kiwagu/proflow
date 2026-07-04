import type * as React from 'react';

import type { LensNode } from '@/app/graph/containment';

/** One Drive row for the table view — a folder, a shortcut, or a content item. */
export type DriveRow = {
  id: string;
  node: LensNode;
  rowKind: 'folder' | 'shortcut' | 'item';
  /** Double-click / Enter: navigate in / open the reader. */
  onOpen: () => void;
  /** Single click: open the shared Details panel. */
  onDetails: () => void;
  /** Hover row actions: folders/items carry the `⋯` menu; a shortcut carries
   * "Open in KB" (jump to the target's canonical home) + "Remove shortcut". */
  actions: React.ReactNode | null;
  /** Tree mode (browse): a folder's children (folders then content), recursively.
   * Undefined in flat lenses → the table renders flat. */
  subRows?: DriveRow[];
};
