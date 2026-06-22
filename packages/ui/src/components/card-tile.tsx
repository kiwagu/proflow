'use client';

import * as React from 'react';

import { cn } from '@workspace/ui/lib/utils';

/**
 * CardTile — the small, clickable "surface card" repeated across the KB
 * projections: a `--card` background, a hairline border that lights to `--ring`
 * on hover, `shadow-xs`, rounded corners and a color transition, laid out as a
 * horizontal `flex items-center` row. It is the inlined `bg-card hover:border-ring
 * ... rounded-lg border shadow-xs transition-colors` surface the Drive folder/file
 * cards and the Notion backlink rows each re-declared; promoting it keeps the
 * rendered markup IDENTICAL while removing the duplication. Mechanism only —
 * content (icon-tile, title, meta, trailing affordance) is children.
 *
 * It renders a real `<button>` (every use is clickable). `radius` picks the
 * pixel-exact corner (`lg` for the grid cards, `md` for the denser backlink rows);
 * `shadow` toggles the `shadow-xs` lift (the denser Notion backlink rows have none);
 * padding/gap stay with the caller via `className` (they differ per density).
 * Semantic tokens only — dark mode is automatic.
 */

export type CardTileProps = React.ComponentPropsWithoutRef<'button'> & {
  radius?: 'md' | 'lg';
  /** Render the `shadow-xs` lift (default). The dense backlink rows pass false. */
  shadow?: boolean;
};

const RADIUS_CLASS: Record<NonNullable<CardTileProps['radius']>, string> = {
  md: 'rounded-md',
  lg: 'rounded-lg',
};

export function CardTile({
  className,
  radius = 'lg',
  shadow = true,
  type = 'button',
  ...props
}: CardTileProps) {
  return (
    <button
      type={type}
      className={cn(
        'bg-card hover:border-ring flex items-center border transition-colors',
        shadow && 'shadow-xs',
        RADIUS_CLASS[radius],
        className
      )}
      {...props}
    />
  );
}
