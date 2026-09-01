'use client';

import {
  TRY_INSERT_TABLE_PICKER_COMMAND,
  useLexicalWrapper,
} from '@workspace/lexical-react';
import { Button } from '@workspace/ui/components/button';
import { Hint } from '@workspace/ui/components/hint';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@workspace/ui/components/popover';
import { cn } from '@workspace/ui/lib/utils';
import { INSERT_TABLE_COMMAND } from '@lexical/table';
import { Table as TableIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { defaultTableInsertLabels, type TableInsertLabels } from './labels.js';

const MAX_ROWS = 8;
const MAX_COLUMNS = 8;

export type TableInsertProps = {
  labels?: TableInsertLabels;
  /** Grid size cap; defaults to 8×8. */
  maxRows?: number;
  maxColumns?: number;
  className?: string;
};

/**
 * The table-size picker: a toolbar button opening an N×M hover grid; picking
 * a cell dispatches INSERT_TABLE_COMMAND with that size. Also answers the
 * editor's own picker request command (slash-command/menu driven inserts),
 * so any dispatcher of that command opens this popover rather than falling
 * back to a blind default size. Must render inside a DocumentView.
 */
export function TableInsert({
  labels = defaultTableInsertLabels,
  maxRows = MAX_ROWS,
  maxColumns = MAX_COLUMNS,
  className,
}: TableInsertProps) {
  const wrapper = useLexicalWrapper();
  const editor = wrapper.editor;
  const disabled = !wrapper.isInteractable();

  const [open, setOpen] = useState(false);
  // Hovered size; the grid highlights the rows×columns rectangle up-left of it.
  const [hover, setHover] = useState<{ rows: number; columns: number } | null>(
    null
  );

  // Serve in-editor picker requests while mounted.
  useEffect(() => {
    return editor.registerCommand(
      TRY_INSERT_TABLE_PICKER_COMMAND,
      () => {
        setOpen(true);
        return true;
      },
      1 // COMMAND_PRIORITY_LOW; the plugin's own handler sits at NORMAL.
    );
  }, [editor]);

  const insert = (rows: number, columns: number) => {
    editor.dispatchCommand(INSERT_TABLE_COMMAND, {
      rows: String(rows),
      columns: String(columns),
    });
    setOpen(false);
    setHover(null);
    editor.focus();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setHover(null);
      }}
    >
      <Hint label={labels.insertTable}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={labels.insertTable}
            disabled={disabled}
            className={className}
          >
            <TableIcon aria-hidden />
          </Button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent className="w-auto p-2" align="start">
        <div
          role="grid"
          aria-label={labels.insertTable}
          className="flex flex-col gap-1"
          onPointerLeave={() => setHover(null)}
        >
          {Array.from({ length: maxRows }, (_, r) => (
            <div key={r} role="row" className="flex gap-1">
              {Array.from({ length: maxColumns }, (_, c) => {
                const rows = r + 1;
                const columns = c + 1;
                const active =
                  hover !== null &&
                  rows <= hover.rows &&
                  columns <= hover.columns;
                return (
                  <button
                    key={c}
                    type="button"
                    role="gridcell"
                    aria-label={labels.size(rows, columns)}
                    className={cn(
                      'size-4 rounded-xs border border-border',
                      active ? 'border-transparent bg-accent' : 'bg-background'
                    )}
                    onPointerEnter={() => setHover({ rows, columns })}
                    onFocus={() => setHover({ rows, columns })}
                    onClick={() => insert(rows, columns)}
                  />
                );
              })}
            </div>
          ))}
          <div className="pt-1 text-center text-xs text-muted-foreground">
            {hover ? labels.size(hover.rows, hover.columns) : '\u00a0'}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
