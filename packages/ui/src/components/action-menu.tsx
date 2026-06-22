'use client';

import * as React from 'react';

import { Button } from '@workspace/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu';
import { cn } from '@workspace/ui/lib/utils';
import { MoreHorizontal } from 'lucide-react';

/**
 * ActionMenu — a generic `⋯` overflow-action menu: a ghost icon trigger that opens
 * a `DropdownMenu` of caller-supplied actions. Mechanism only — it knows nothing
 * about the domain: labels/icons are passed in as nodes, behaviour as `onSelect`.
 * The content sizes to the WIDEST row (`w-max` + `whitespace-nowrap`) instead of the
 * tiny trigger width, so labels never clip across locales. Compose confirm/prompt
 * flows by pairing it with {@link ConfirmDialog} / {@link PromptDialog} as siblings.
 */

export type ActionMenuItem = {
  id: string;
  label: React.ReactNode;
  /** Pre-rendered leading icon (e.g. `<Pencil className="size-4" />`). */
  icon?: React.ReactNode;
  onSelect: () => void;
  variant?: 'default' | 'destructive';
  /** Draw a separator above this item (section break). */
  separatorBefore?: boolean;
  hidden?: boolean;
  /** Render the item but block selection (greyed out). */
  disabled?: boolean;
};

export function ActionMenu({
  items,
  label,
  align = 'end',
  triggerClassName,
  contentClassName,
  trigger,
}: {
  items: ActionMenuItem[];
  /** Accessible name for the default `⋯` trigger. */
  label: string;
  align?: 'start' | 'center' | 'end';
  /** Extra classes for the default trigger (e.g. hover-reveal on a card). */
  triggerClassName?: string;
  contentClassName?: string;
  /** Replace the default `⋯` ghost icon button entirely. */
  trigger?: React.ReactNode;
}) {
  const visible = items.filter((item) => !item.hidden);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            className={cn('text-muted-foreground', triggerClassName)}
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className={cn('w-max whitespace-nowrap', contentClassName)}
      >
        {visible.map((item) => (
          <React.Fragment key={item.id}>
            {item.separatorBefore ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              variant={item.variant}
              disabled={item.disabled}
              onSelect={item.onSelect}
            >
              {item.icon}
              {item.label}
            </DropdownMenuItem>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
