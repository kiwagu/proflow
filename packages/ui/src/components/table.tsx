import * as React from 'react';

import { cn } from '@workspace/ui/lib/utils';

/**
 * Table — the shadcn table PRIMITIVE: thin, presentational wrappers over the
 * native table elements with the design-system's semantic tokens. Mechanism only
 * (no data logic) — pair it with {@link DataTable} (TanStack-powered) for sorting /
 * pagination / filtering, or use the parts directly for a static table. Semantic
 * tokens throughout, so dark mode is automatic.
 */

function Table({
  className,
  ...props
}: React.ComponentPropsWithoutRef<'table'>) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({
  className,
  ...props
}: React.ComponentPropsWithoutRef<'thead'>) {
  return <thead className={cn('[&_tr]:border-b', className)} {...props} />;
}

function TableBody({
  className,
  ...props
}: React.ComponentPropsWithoutRef<'tbody'>) {
  return (
    <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />
  );
}

function TableFooter({
  className,
  ...props
}: React.ComponentPropsWithoutRef<'tfoot'>) {
  return (
    <tfoot
      className={cn(
        'bg-muted/50 border-t font-medium [&>tr]:last:border-b-0',
        className
      )}
      {...props}
    />
  );
}

function TableRow({
  className,
  ...props
}: React.ComponentPropsWithoutRef<'tr'>) {
  return (
    <tr
      className={cn(
        'hover:bg-muted/50 data-[selected=true]:bg-muted border-b transition-colors',
        className
      )}
      {...props}
    />
  );
}

function TableHead({
  className,
  ...props
}: React.ComponentPropsWithoutRef<'th'>) {
  return (
    <th
      className={cn(
        'text-muted-foreground h-9 px-3 text-left align-middle text-xs font-medium tracking-wide [&:has([role=checkbox])]:pr-0',
        className
      )}
      {...props}
    />
  );
}

function TableCell({
  className,
  ...props
}: React.ComponentPropsWithoutRef<'td'>) {
  return (
    <td
      className={cn(
        'px-3 py-2 align-middle [&:has([role=checkbox])]:pr-0',
        className
      )}
      {...props}
    />
  );
}

function TableCaption({
  className,
  ...props
}: React.ComponentPropsWithoutRef<'caption'>) {
  return (
    <caption
      className={cn('text-muted-foreground mt-4 text-sm', className)}
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
};
