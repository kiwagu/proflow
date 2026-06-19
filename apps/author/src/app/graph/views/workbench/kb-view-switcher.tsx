'use client';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import {
  SegmentedControl,
  SegmentedControlButton,
} from '@workspace/ui/components/segmented-control';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@workspace/ui/components/tooltip';

import {
  KB_VARIANTS,
  kbVariantLabel,
  type KbVariantId,
} from '@/app/graph/views/registry';

/**
 * KbViewSwitcher — the prototype `app.jsx` variant segment, pixel-1:1 (slice-11
 * Ф3 §1). A pill-shaped segmented control over `--muted`, one button per variant,
 * the active one lifted onto `--background` with `shadow-sm`. Flips the SAME graph
 * between the four projections (Invariant #1) — it does NOT load a different saved
 * projection (that was the retired projection-switcher; ADR-0014 §2).
 *
 * Notion/Graph are not live yet (Ф4/Ф5): their tabs are DISABLED with a "soon"
 * tooltip rather than fake content (poc-no-fallbacks). Sizes/spacing match the
 * prototype exactly (gap 3 / padding 3 / 6px 14px buttons / 15px icons); color is
 * always a token so dark mode works.
 */

export type KbViewSwitcherProps = {
  t: GraphTranslator;
  active: KbVariantId;
  onChange: (id: KbVariantId) => void;
};

export function KbViewSwitcher({ t, active, onChange }: KbViewSwitcherProps) {
  return (
    <TooltipProvider>
      <SegmentedControl>
        {KB_VARIANTS.map((variant) => {
          const on = variant.id === active;
          const Icon = variant.icon;
          const button = (
            <SegmentedControlButton
              active={on}
              disabled={!variant.live}
              onClick={() => variant.live && onChange(variant.id)}
            >
              <Icon className="size-[15px]" aria-hidden />
              {kbVariantLabel(t, variant.id)}
            </SegmentedControlButton>
          );

          if (variant.live) {
            return <span key={variant.id}>{button}</span>;
          }
          // Not-landed view: disabled tab + "soon" tooltip (no fake content).
          return (
            <Tooltip key={variant.id}>
              <TooltipTrigger asChild>
                <span tabIndex={0}>{button}</span>
              </TooltipTrigger>
              <TooltipContent>{t('graph.variant.soon')}</TooltipContent>
            </Tooltip>
          );
        })}
      </SegmentedControl>
    </TooltipProvider>
  );
}
