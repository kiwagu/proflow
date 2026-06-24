'use client';

import {
  type ColumnDef,
  type Row,
  type RowData,
  type SortingState,
  type Table as TableInstance,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import * as React from 'react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@workspace/ui/components/table';
import { textSortingFn } from '@workspace/ui/lib/sort';
import { cn } from '@workspace/ui/lib/utils';

export type { ColumnDef } from '@tanstack/react-table';

/** Per-column display hints (alignment / width) — applied to head + cell. */
declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Tailwind classes for both the header and body cell of this column. */
    cellClassName?: string;
    /** Header-only classes (overrides `cellClassName` alignment if needed). */
    headerClassName?: string;
  }
}

const CLICK_DOUBLE_MS = 250;

/**
 * DataTable — the EXTENSIBLE table built on the shadcn {@link Table} primitive +
 * TanStack Table (headless). The base ships sorting and the row models for
 * filtering / pagination / visibility / selection; a simple consumer (e.g. a file
 * list) passes only `columns` + `data` (+ row click handlers) and gets a lean
 * table, while a complex screen opts into `pagination`, drives column filters /
 * visibility / selection through the `table` instance exposed to `toolbar` /
 * `footer`, and renders its own controls. One core, two ends of the spectrum.
 *
 * Row interaction mirrors the workbench cards: single click → `onRowClick`
 * (debounced), double click / Enter → `onRowActivate` (the "open" action). Cells
 * that own their own controls should stop propagation so a row click doesn't fire.
 */
export type DataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Stable row id (domain id) — keyed rows + selection. */
  getRowId?: (row: TData, index: number) => string;
  /** Shown in place of the body when `data` is empty. */
  empty?: React.ReactNode;

  /** Initial sort (e.g. by name) so the table opens in a sensible order. */
  defaultSorting?: SortingState;

  // row interaction
  onRowClick?: (row: TData) => void;
  onRowActivate?: (row: TData) => void;
  /** Highlight the row whose id (per `getRowId`) matches (visual, not selection). */
  activeRowId?: string;

  // opt-in features — off by default keeps the table lean
  /** Page size to enable client pagination, or false (default) for none. */
  pagination?: number | false;
  enableRowSelection?: boolean;
  /**
   * Keep rows in stable GROUPS that never interleave: rows sort by this rank FIRST
   * (ascending, fixed), and the user's column sort applies only WITHIN each group.
   * So e.g. folders always stay above files regardless of sort direction.
   * Ignored in tree mode (`getSubRows`) — the parent/child order is the structure.
   */
  groupOrder?: (row: TData) => number;
  /**
   * TREE mode: return a row's children to make it expandable (a chevron in any cell
   * via `row.getCanExpand()` / `row.getToggleExpandedHandler()` / `row.depth`). The
   * rendered rows become the flattened EXPANDED tree; column sort applies within each
   * level. Off (undefined) → a flat table (the default).
   */
  getSubRows?: (row: TData) => TData[] | undefined;
  /**
   * A column id that is ALWAYS the primary sort, ascending, regardless of the user's
   * column sort (which becomes secondary). Use for a stable group key that survives
   * sort direction — e.g. a hidden "folders before files" rank in a tree (the flat
   * `groupOrder` post-sort cannot, as it would scramble the nesting). The column is
   * auto-hidden.
   */
  pinnedSort?: string;

  // chrome — complex consumers drive controls off the live table instance
  toolbar?: (table: TableInstance<TData>) => React.ReactNode;
  footer?: (table: TableInstance<TData>) => React.ReactNode;
  className?: string;

  /**
   * Optional drag-and-drop wiring for a row — a HOOK the consumer provides (it owns
   * the DnD library + context; the table stays presentation-only). It is called ONCE
   * per row from inside each row's own component instance (keyed by row id), so it may
   * safely call dnd hooks (`useDraggable`/`useDroppable`) — rules-of-hooks hold even as
   * rows expand/collapse. It returns the props to spread onto the row's `<tr>`
   * (draggable handle + droppable target) plus `isDropTarget` (a valid drag is hovering
   * this row) and `isCandidate` (a drag is active and this row is a valid landing zone)
   * flags the table uses to highlight. Returning nothing leaves the row inert.
   */
  rowDnd?: (row: TData) => {
    rowProps?: React.HTMLAttributes<HTMLTableRowElement> & {
      ref?: React.Ref<HTMLTableRowElement>;
    };
    isDropTarget?: boolean;
    isCandidate?: boolean;
  } | void;
};

export function DataTable<TData, TValue>({
  columns,
  data,
  getRowId,
  empty,
  defaultSorting,
  onRowClick,
  onRowActivate,
  activeRowId,
  pagination = false,
  enableRowSelection = false,
  groupOrder,
  getSubRows,
  pinnedSort,
  toolbar,
  footer,
  className,
  rowDnd,
}: DataTableProps<TData, TValue>) {
  // Control ONLY sorting (the proven-minimal config). Filtering / visibility /
  // selection use TanStack's own internal state — still fully drivable through the
  // `table` instance exposed to `toolbar` / `footer` for richer screens, without
  // the controlled-state churn that re-rendered on every sort.
  // `sorting` holds the USER's column sort; `pinnedSort` (if any) is force-prepended
  // as the always-ascending primary so the group never flips with sort direction.
  const [sorting, setSorting] = React.useState<SortingState>(
    defaultSorting ?? []
  );
  const effectiveSorting = pinnedSort
    ? [
        { id: pinnedSort, desc: false },
        ...sorting.filter((s) => s.id !== pinnedSort),
      ]
    : sorting;

  const table = useReactTable({
    data,
    columns,
    getRowId,
    // Human-friendly text ordering (case-insensitive, natural) for every column by
    // default; a column can still override its own `sortingFn`.
    defaultColumn: { sortingFn: textSortingFn },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    ...(getSubRows
      ? { getSubRows, getExpandedRowModel: getExpandedRowModel() }
      : {}),
    ...(pagination ? { getPaginationRowModel: getPaginationRowModel() } : {}),
    enableRowSelection,
    // Strip the pinned primary back out before storing — it is re-prepended each
    // render, so the user's clicks only ever toggle the SECONDARY column sort.
    onSortingChange: (updater) => {
      const next =
        typeof updater === 'function' ? updater(effectiveSorting) : updater;
      setSorting(pinnedSort ? next.filter((s) => s.id !== pinnedSort) : next);
    },
    // No pagination here → don't let a sort queue a page-index reset (which, with
    // the row models recreated each render, can re-fire into a render loop).
    autoResetPageIndex: false,
    initialState: {
      ...(pagination
        ? { pagination: { pageIndex: 0, pageSize: pagination } }
        : {}),
      ...(pinnedSort ? { columnVisibility: { [pinnedSort]: false } } : {}),
    },
    state: { sorting: effectiveSorting },
  });

  // Single vs double click discrimination, shared across rows (one click
  // sequence at a time): the 2nd click activates and cancels the pending single.
  const clickTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (clickTimer.current) {
        clearTimeout(clickTimer.current);
      }
    },
    []
  );
  const rowHandlers = (row: TData) => {
    if (!onRowClick && !onRowActivate) {
      return {};
    }
    return {
      role: 'button' as const,
      tabIndex: 0,
      className: 'cursor-pointer outline-none',
      onClick: (event: React.MouseEvent) => {
        if (event.detail > 1) {
          if (clickTimer.current) {
            clearTimeout(clickTimer.current);
            clickTimer.current = null;
          }
          onRowActivate?.(row);
          return;
        }
        if (clickTimer.current) {
          clearTimeout(clickTimer.current);
        }
        clickTimer.current = setTimeout(() => {
          clickTimer.current = null;
          onRowClick?.(row);
        }, CLICK_DOUBLE_MS);
      },
      onKeyDown: (event: React.KeyboardEvent) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onRowActivate?.(row);
        }
      },
    };
  };

  // Keep groups blocked (e.g. folders above files): after the user's column sort,
  // STABLE-partition the rows by `groupOrder` (a stable sort by rank alone keeps
  // the within-group order, so sort DIRECTION never reshuffles the blocks). Pure
  // render-time derivation — no table state is touched.
  const sortedRows = table.getRowModel().rows;
  const rows =
    groupOrder && !getSubRows
      ? [...sortedRows].sort(
          (a, b) => groupOrder(a.original) - groupOrder(b.original)
        )
      : sortedRows;
  const colCount = table.getVisibleLeafColumns().length;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {toolbar ? toolbar(table) : null}
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                return (
                  <TableHead
                    key={header.id}
                    className={
                      header.column.columnDef.meta?.headerClassName ??
                      header.column.columnDef.meta?.cellClassName
                    }
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="hover:text-foreground -ml-1 inline-flex items-center gap-1 rounded px-1 transition-colors"
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                        {sorted === 'asc' ? (
                          <ArrowUp className="size-3.5" aria-hidden />
                        ) : sorted === 'desc' ? (
                          <ArrowDown className="size-3.5" aria-hidden />
                        ) : (
                          <ChevronsUpDown
                            className="size-3.5 opacity-50"
                            aria-hidden
                          />
                        )}
                      </button>
                    ) : (
                      flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={colCount} className="h-24 text-center">
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <DataTableRow
                key={row.id}
                row={row}
                rowProps={rowHandlers(row.original)}
                active={activeRowId != null && row.id === activeRowId}
                rowDnd={rowDnd}
              />
            ))
          )}
        </TableBody>
      </Table>
      {footer ? footer(table) : null}
    </div>
  );
}

/**
 * One table row, as its OWN component so a per-row dnd hook (`rowDnd`) is called
 * exactly once per instance (keyed by row id) — rules-of-hooks safe even as the row
 * set grows/shrinks (tree expand/collapse). `rowProps` carries the shared
 * single/double-click handlers; `rowDnd` (if any) layers on draggable/droppable.
 */
function DataTableRow<TData>({
  row,
  rowProps,
  active,
  rowDnd,
}: {
  row: Row<TData>;
  rowProps: React.HTMLAttributes<HTMLTableRowElement>;
  active: boolean;
  rowDnd?: (row: TData) => {
    rowProps?: React.HTMLAttributes<HTMLTableRowElement> & {
      ref?: React.Ref<HTMLTableRowElement>;
    };
    isDropTarget?: boolean;
    isCandidate?: boolean;
  } | void;
}) {
  const dnd = rowDnd?.(row.original) || undefined;
  const dndProps = dnd?.rowProps;
  return (
    <TableRow
      data-selected={active ? true : undefined}
      data-drop-target={dnd?.isDropTarget ? true : undefined}
      {...rowProps}
      {...dndProps}
      className={cn(
        rowProps.className,
        dndProps?.className,
        dnd?.isCandidate &&
          !dnd?.isDropTarget &&
          'ring-ring/30 ring-1 ring-inset',
        dnd?.isDropTarget && 'bg-accent/60 ring-ring/40 ring-1 ring-inset'
      )}
    >
      {row.getVisibleCells().map((cell) => (
        <TableCell
          key={cell.id}
          className={cell.column.columnDef.meta?.cellClassName}
        >
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </TableCell>
      ))}
    </TableRow>
  );
}
