'use client';

import * as React from 'react';

import { cn } from '@workspace/ui/lib/utils';

/**
 * CardTile — the small "surface card" repeated across the KB projections: a
 * `--card` background, a hairline border, `shadow-xs`, rounded corners laid out as a
 * `flex` row. It is the inlined `bg-card ... rounded-lg border shadow-xs` surface the
 * Drive folder/file cards, the Trash cards and the Notion backlink rows each
 * re-declared; promoting it keeps the rendered markup IDENTICAL while removing the
 * duplication. Mechanism only — content (icon-tile, title, meta, trailing affordance)
 * is children.
 *
 * By default it renders a real, clickable `<button>` with the `hover:border-ring`
 * affordance + `transition-colors`, plus `items-center` (the common row alignment).
 * `radius` picks the pixel-exact corner (`lg` for the grid cards, `md` for the denser
 * backlink rows); `shadow` toggles the `shadow-xs` lift; padding/gap stay with the
 * caller via `className`.
 *
 * `interactive={false}` renders a NON-clickable `<div>` instead — the same `bg-card`
 * surface WITHOUT the button-only affordances (`hover:border-ring`, `transition-colors`,
 * `items-center`, `type`). Trash cards use it because they must nest their own
 * Restore/Purge buttons (which can't live inside a `<button>`) and control their own
 * per-layout alignment via `className`. Semantic tokens only — dark mode is automatic.
 */

type SharedCardTileProps = {
  radius?: 'md' | 'lg';
  /** Render the `shadow-xs` lift (default). The dense backlink rows pass false. */
  shadow?: boolean;
};

export type CardTileProps =
  | (React.ComponentPropsWithoutRef<'button'> &
      SharedCardTileProps & { interactive?: true })
  | (React.ComponentPropsWithoutRef<'div'> &
      SharedCardTileProps & { interactive: false });

const RADIUS_CLASS: Record<
  NonNullable<SharedCardTileProps['radius']>,
  string
> = {
  md: 'rounded-md',
  lg: 'rounded-lg',
};

export function CardTile(props: CardTileProps) {
  const { radius = 'lg', shadow = true } = props;

  if (props.interactive === false) {
    const {
      interactive: _interactive,
      radius: _radius,
      shadow: _shadow,
      className,
      ...rest
    } = props;
    return (
      <div
        className={cn(
          'bg-card flex border',
          shadow && 'shadow-xs',
          RADIUS_CLASS[radius],
          className
        )}
        {...rest}
      />
    );
  }

  const {
    interactive: _interactive,
    radius: _radius,
    shadow: _shadow,
    className,
    type = 'button',
    ...rest
  } = props;
  return (
    <button
      type={type}
      className={cn(
        'bg-card hover:border-ring flex items-center border transition-colors',
        shadow && 'shadow-xs',
        RADIUS_CLASS[radius],
        className
      )}
      {...rest}
    />
  );
}
