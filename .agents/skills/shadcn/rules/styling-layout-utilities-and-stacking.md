# Styling: Layout Utilities and Stacking

## Pyramid Layer

- Layer: L3 rule leaf.

## Use This When

- Load this after the styling router when the task is about spacing utilities, `className` usage, truncation, dark-mode overrides, conditional class merging, or overlay stacking.

## Stop Here If

- Stop once the layout or stacking rule is clear.

## Descend To

- Return to `/.agents/skills/shadcn/rules/styling.md` for semantic-token siblings.

## className Is for Layout Only

Use `className` for layout like `max-w-md`, `mx-auto`, or `mt-4`, not for overriding colors or typography.

## No space-x or space-y

Use `gap-*` instead. For vertical stacks, use `flex flex-col gap-*`.

## Prefer size-* When Width and Height Match

Use `size-10` rather than `w-10 h-10`.

## Prefer truncate

Use `truncate` instead of `overflow-hidden text-ellipsis whitespace-nowrap`.

## No Manual dark: Color Overrides

Use semantic tokens so light and dark themes stay driven by CSS variables.

## Use cn() for Conditional Classes

Prefer the project's `cn()` utility over manual template-literal ternaries.

## No Manual z-index on Overlay Components

`Dialog`, `Sheet`, `Drawer`, `AlertDialog`, `DropdownMenu`, `Popover`, `Tooltip`, and `HoverCard` manage their own stacking.