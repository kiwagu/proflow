'use client';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Button } from '@workspace/ui/components/button';
import { Hint } from '@workspace/ui/components/hint';
import { cn } from '@workspace/ui/lib/utils';
import * as React from 'react';

import type { LensView } from '@/app/graph/views/registry/projection-view.types';

/**
 * LensViewToggle — the shared Flat ↔ Advanced lens display-mode segmented control
 * (ADR-0022 Fork 4 + Addendum A). The SAME control the structural lenses (Shared /
 * Shared-by-me / Starred) and the lexical-search lens carry, lifted here so the
 * identical JSX is not inlined at each call-site (ui-primitive-hygiene).
 *
 * Pure presentation: the caller owns the SHOW condition (structural lenses gate on
 * `isStructuralLens`, search gates on the presence of `onLensViewChange`). Present +
 * Pro-gated — when NOT `entitled` it renders DISABLED, wrapped in a Hint with the
 * upsell copy, NEVER hidden (the locked control IS the upsell, Fork 2). The server
 * clamps `?view=` to 'flat' on a locked plan, so even a forged URL stays flat.
 */
export function LensViewToggle({
  t,
  lensView,
  onLensViewChange,
  entitled,
}: {
  t: GraphTranslator;
  lensView: LensView;
  onLensViewChange: (view: LensView) => void;
  entitled: boolean;
}) {
  return (
    <Hint
      label={
        entitled
          ? undefined
          : t('graph.drive.advancedStructuralLocked', {
              tariff: t('graph.drive.advancedStructuralTariff'),
            })
      }
    >
      <div
        className="flex overflow-hidden rounded-md border"
        aria-disabled={!entitled}
      >
        <Button
          type="button"
          variant="segmented"
          onClick={() => onLensViewChange('flat')}
          disabled={!entitled}
          aria-label={t('graph.drive.lensViewFlat')}
          aria-pressed={lensView === 'flat'}
          className={cn(
            'h-7 px-2 text-xs font-medium disabled:pointer-events-auto disabled:opacity-100',
            !entitled && 'cursor-not-allowed opacity-60'
          )}
        >
          {t('graph.drive.lensViewFlat')}
        </Button>
        <Button
          type="button"
          variant="segmented"
          onClick={() => onLensViewChange('advanced')}
          disabled={!entitled}
          aria-label={t('graph.drive.lensViewAdvanced')}
          aria-pressed={lensView === 'advanced'}
          className={cn(
            'border-l-border h-7 border-l px-2 text-xs font-medium disabled:pointer-events-auto disabled:opacity-100',
            !entitled && 'cursor-not-allowed opacity-60'
          )}
        >
          {t('graph.drive.lensViewAdvanced')}
        </Button>
      </div>
    </Hint>
  );
}
