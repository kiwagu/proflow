import * as React from 'react';

import { cn } from '@workspace/ui/lib/utils';

/**
 * IconTile — a rounded square that centers an icon (or any small node), the
 * "kind chip" repeated across the KB cards, list rows and panel/canvas headers
 * (a folder icon on `--muted`, a header glyph on `--primary`). It is the inlined
 * `grid place-items-center rounded-* shrink-0` wrapper lifted to one primitive so
 * the shape stays identical everywhere. Mechanism only — the icon is children.
 *
 * `tone` picks the surface (muted chip vs. primary header tile); `size` picks the
 * pixel-exact box (`8`/`size-8 rounded-md` for the compact panel header glyph,
 * `9`/`size-9 rounded-md` for cards, `10`/`size-10 rounded-lg` for headers).
 * Semantic tokens only, so dark mode is automatic; extra classes compose via
 * `className`.
 */

export type IconTileProps = React.ComponentPropsWithoutRef<'div'> & {
  tone?: 'muted' | 'primary';
  size?: 8 | 9 | 10;
};

const SIZE_CLASS: Record<NonNullable<IconTileProps['size']>, string> = {
  8: 'size-8 rounded-md',
  9: 'size-9 rounded-md',
  10: 'size-10 rounded-lg',
};

const TONE_CLASS: Record<NonNullable<IconTileProps['tone']>, string> = {
  muted: 'bg-muted',
  primary: 'bg-primary text-primary-foreground',
};

export function IconTile({
  className,
  tone = 'muted',
  size = 9,
  ...props
}: IconTileProps) {
  return (
    <div
      className={cn(
        'grid shrink-0 place-items-center',
        SIZE_CLASS[size],
        TONE_CLASS[tone],
        className
      )}
      {...props}
    />
  );
}
