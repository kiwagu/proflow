import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import * as React from 'react';

import type { NodeMeta } from '@/app/graph/graph-data.types';
import { iconForKind, kindLabel, ownerLabel } from '@/app/graph/presentation';

/**
 * lens-row-cells — the per-column CELL CONTENT shared by EVERY lens list/tree row, so
 * the name (kind icon + title), type, owner and modified renderings can never drift
 * between the Drive list table (`LensListTable`) and any future lens that renders the
 * same row-set (the lexical-search table/tree, ADR-0025 Step 0). One source of truth
 * for each cell + its em-dash fallbacks.
 *
 * Each helper is a pure `(…) => ReactNode` over the shared row shape; the WRAPPING (a
 * TanStack `ColumnDef.cell` vs a bare `<TableCell>`, the tree chevron, the shortcut
 * arrow, the access-mirror badge) stays with each consumer — only the irreducible cell
 * BODY lives here.
 *
 * Owner + modified read from `NodeMeta` for resolved-canvas rows and DEGRADE to an em
 * dash when a row carries no meta (an out-of-canvas hit is a superset of the resolved
 * canvas — those rows never crash; ADR-0024 §1).
 */

/**
 * Name = kind icon + truncated title. `depthPx` indents the name cell for a tree row
 * (undefined = the flat look, no indent); `muted` styles a structural PATH folder
 * (tree only). Both default to the flat, un-muted Drive look so existing list rows are
 * byte-identical. Callers compose the chevron / shortcut arrow / shared badge AROUND
 * this body.
 */
export function nameCell(
  kind: string,
  title: string,
  opts?: { depthPx?: number; muted?: boolean }
): React.ReactNode {
  const depthPx = opts?.depthPx;
  const muted = opts?.muted ?? false;
  return (
    <div
      className="flex min-w-0 items-center gap-2.5"
      style={depthPx === undefined ? undefined : { paddingLeft: depthPx }}
    >
      {React.createElement(iconForKind(kind), {
        className: 'text-muted-foreground size-[18px] shrink-0',
        'aria-hidden': true,
      })}
      <span
        className={
          muted
            ? 'text-muted-foreground truncate font-medium'
            : 'truncate font-medium'
        }
      >
        {title}
      </span>
    </div>
  );
}

/** Type = the localized kind label, muted. */
export function typeCell(t: GraphTranslator, kind: string): React.ReactNode {
  return <span className="text-muted-foreground">{kindLabel(t, kind)}</span>;
}

/** Owner = the owner label, or an em dash when the row carries no meta. */
export function ownerCell(
  t: GraphTranslator,
  meta: NodeMeta | undefined,
  currentUserId: string | null
): React.ReactNode {
  return (
    <span className="text-muted-foreground">
      {meta ? ownerLabel(t, meta.ownerUserId, currentUserId) : '—'}
    </span>
  );
}

/** Modified = the localized date, or an em dash when absent. */
export function modifiedCell(value: string | undefined): React.ReactNode {
  return (
    <span className="text-muted-foreground">
      {value ? new Date(value).toLocaleDateString() : '—'}
    </span>
  );
}
