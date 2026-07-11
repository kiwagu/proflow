'use client';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@workspace/ui/components/popover';
import { ToggleChip } from '@workspace/ui/components/toggle-chip';
import { Check, SlidersHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import * as React from 'react';

/**
 * DriveFiltersMenu — the lens facet filters (tag / status / shared-mechanism) collapsed
 * into ONE dropdown panel anchored in the toolbar at the "Only files" chip level, so the
 * facets no longer occupy a fixed content row that eats vertical space. The trigger is
 * the same `filterChip` pill as "Only files" (with an active-count badge), so the whole
 * filter cluster reads as one control group.
 *
 * The panel lays each facet as its OWN COLUMN (label on top, its option chips stacked
 * below): the columns flex-wrap as atomic units, so a facet with many options never
 * bleeds its chips under another facet's — one filter's options always stay grouped in
 * one column. ONE structure (`FacetColumn`) drives all three facets — a new facet is a
 * descriptor, not a fork (lens-feature-component-reuse). Display only; each `onSelect`
 * mutates the caller's client-side facet state (never a fence).
 */

export type FacetOption = {
  /** Stable key/id for the chip. */
  id: string;
  label: string;
  selected: boolean;
  /** Optional leading icon (the shared-mechanism facet uses per-option icons). */
  icon?: LucideIcon;
  /** Radio-style select OR multi-toggle — the caller decides; the reported value is
   * ignored (the chip only signals intent). */
  onSelect: () => void;
};

export type FacetColumn = {
  key: string;
  label: string;
  icon: LucideIcon;
  /** True when no option is chosen (the "All" state) — drives the "All" chip + the
   * active-count badge on the trigger. */
  allSelected: boolean;
  /** Clear this facet back to "All". */
  onClear: () => void;
  options: FacetOption[];
};

export function DriveFiltersMenu({
  t,
  columns,
}: {
  t: GraphTranslator;
  /** The facets to offer — already filtered to those with something to filter (≥2
   * distinct values). Empty → the menu renders nothing. */
  columns: FacetColumn[];
}) {
  if (columns.length === 0) {
    return null;
  }
  const activeCount = columns.filter((col) => !col.allSelected).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="filterChip"
          size="pill"
          aria-pressed={activeCount > 0}
        >
          <SlidersHorizontal className="size-3" aria-hidden />
          {t('graph.lens.filters')}
          {activeCount > 0 ? (
            <Badge
              variant="secondary"
              className="ml-0.5 h-4 min-w-4 justify-center rounded-full px-1 text-[10px] font-medium tabular-nums"
            >
              {activeCount}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto max-w-[min(92vw,34rem)]">
        <div className="flex flex-wrap gap-x-6 gap-y-4">
          {columns.map((col) => {
            const Icon = col.icon;
            return (
              <div key={col.key} className="flex min-w-[140px] flex-col gap-2">
                <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs font-medium">
                  <Icon className="size-3.5" aria-hidden />
                  {col.label}
                </span>
                <div className="flex flex-col items-start gap-1.5">
                  <ToggleChip
                    label={t('graph.drive.facetAll')}
                    pressed={col.allSelected}
                    onPressedChange={col.onClear}
                  />
                  {col.options.map((option) => (
                    <ToggleChip
                      key={option.id}
                      label={option.label}
                      pressed={option.selected}
                      icon={
                        option.icon ?? (option.selected ? Check : undefined)
                      }
                      onPressedChange={option.onSelect}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
