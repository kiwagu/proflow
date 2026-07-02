import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

import { cn } from '@workspace/ui/lib/utils';

const buttonVariants = cva(
  "group/button focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:ring-3 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:ring-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/80',
        outline:
          'border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50 shadow-xs',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        ghost:
          'hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50',
        destructive:
          'bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40',
        link: 'text-primary underline-offset-4 hover:underline',
        // A zero-chrome inline text affordance: muted text that brightens to
        // foreground on hover, with no box, border, or background at any state.
        // Pair with `size={null}` (it carries no height/padding of its own) and
        // a per-site weight (`font-semibold`/`font-normal`). Used for breadcrumb
        // crumbs and similar inline navigational text.
        crumb:
          'text-muted-foreground hover:text-foreground h-auto rounded-none p-0 font-normal',
        // A segmented-strip toggle item: muted when off, lifted onto `--accent`
        // when on, driven entirely by `aria-pressed`. No hover treatment (a
        // segmented control signals state, not hover). `rounded-none` so it sits
        // flush inside an `overflow-hidden` strip; a standalone toggle re-adds
        // its own `rounded-md`/`border` per site. Geometry and dividers are the
        // caller's (segments vary: text vs icon, first vs middle).
        segmented:
          'text-muted-foreground aria-pressed:bg-accent aria-pressed:text-foreground rounded-none',
        // A standalone on/off FILTER CHIP: a bordered pill that reads muted when off
        // (hovering it to `--accent` previews the toggle) and lifts onto `--accent`
        // with a seamless border when on, driven entirely by `aria-pressed`. Unlike
        // `segmented` (a flush strip item), a chip stands alone — it keeps its own
        // border and hover treatment. Pair with `size="pill"`. Used by every lens
        // display filter (share-facet chips, cross-lens toggles).
        filterChip:
          'text-muted-foreground border-border hover:bg-accent hover:text-foreground aria-pressed:bg-accent aria-pressed:text-foreground aria-pressed:border-transparent',
      },
      size: {
        default:
          'h-9 gap-1.5 px-2.5 in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),8px)] px-2 text-xs in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-8 gap-1 rounded-[min(var(--radius-md),10px)] px-2.5 in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5',
        lg: 'h-10 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        pill: "h-7 gap-1.5 rounded-full px-3 text-xs [&_svg:not([class*='size-'])]:size-3",
        icon: 'size-9',
        'icon-xs':
          "size-6 rounded-[min(var(--radius-md),8px)] in-data-[slot=button-group]:rounded-md [&_svg:not([class*='size-'])]:size-3",
        'icon-sm':
          'size-8 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-md',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
