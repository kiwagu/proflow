# Composition: Overlays and Structural Contracts

## Pyramid Layer

- Layer: L3 rule leaf.

## Use This When

- Load this after the composition router when the task is about grouped items, overlays, cards, tabs, button loading states, or avatar structure.

## Stop Here If

- Stop once the structural composition rule is clear.

## Descend To

- Return to `/.agents/skills/shadcn/rules/composition.md` for feedback or utility siblings.

## Group-Based Items Stay Inside Their Group

Never render group-bound items directly inside the content container.

This applies to `SelectItem` in `SelectGroup`, `DropdownMenuItem` in `DropdownMenuGroup`, `CommandItem` in `CommandGroup`, and similar pairs.

## Choose the Right Overlay

| Use case | Component |
| --- | --- |
| Focused task requiring input | `Dialog` |
| Destructive confirmation | `AlertDialog` |
| Side panel with details or filters | `Sheet` |
| Mobile-first bottom panel | `Drawer` |
| Quick info on hover | `HoverCard` |
| Small contextual click content | `Popover` |

## Dialog, Sheet, and Drawer Need a Title

Use `DialogTitle`, `SheetTitle`, or `DrawerTitle`. Hide visually with `className="sr-only"` if needed.

## Card Structure

Use full card composition with `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, and `CardFooter`.

## Button Has No isPending or isLoading Prop

Compose with `Spinner`, `data-icon`, and `disabled`.

## TabsTrigger Must Be Inside TabsList

Always wrap `TabsTrigger` in `TabsList`.

## Avatar Needs AvatarFallback

Always include `AvatarFallback` for failed image loads.