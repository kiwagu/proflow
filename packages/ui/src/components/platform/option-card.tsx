import type * as React from 'react';

import { Button } from '@workspace/ui/components/button';
import { cn } from '@workspace/ui/lib/utils';

/**
 * OptionCard — a single selectable radio-card row: a leading radio dot, an icon, and a
 * title + optional subtitle, with a `ring` highlight when selected. Generic and i18n-free:
 * the caller supplies the resolved `title`/`subtitle` strings, the `icon` node, and the
 * `selected`/`onSelect` wiring; the caller owns the enclosing `role="radiogroup"`. Built on
 * the shared `Button` (`role="radio"` + `aria-checked`) so keyboard/focus behaviour matches
 * the rest of the UI.
 */
export function OptionCard({
  selected,
  onSelect,
  icon,
  title,
  subtitle,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'border-border flex h-auto items-center justify-start gap-3 rounded-md border px-3 py-2.5 text-left font-normal transition-colors',
        selected
          ? 'border-ring ring-ring/35 ring-[3px] hover:bg-transparent'
          : 'hover:bg-accent'
      )}
    >
      <span
        aria-hidden
        className={cn(
          'grid size-4 shrink-0 place-items-center rounded-full border',
          selected ? 'border-primary' : 'border-muted-foreground/50'
        )}
      >
        {selected ? <span className="bg-primary size-2 rounded-full" /> : null}
      </span>
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {subtitle ? (
          <span className="text-muted-foreground block truncate text-xs">
            {subtitle}
          </span>
        ) : null}
      </span>
    </Button>
  );
}
