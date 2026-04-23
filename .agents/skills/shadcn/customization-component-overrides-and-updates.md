# Customization: Component Overrides and Updates

## Pyramid Layer

- Layer: L3 reference leaf.

## Use This When

- Load this after the customization router when the task is about changing component appearance, adding variants, wrapping primitives, or safely previewing updates.

## Stop Here If

- Stop once the override or update strategy is clear.

## Descend To

- Styling constraints: `/.agents/skills/shadcn/rules/styling.md`
- Return to `/.agents/skills/shadcn/customization.md` for theme-variable or preset siblings.

## Customizing Components

Prefer these approaches in order:

1. Built-in variants
2. Tailwind classes via `className`
3. Add a new variant in the component source
4. Wrapper components

### Built-in Variants

```tsx
<Button variant="outline" size="sm">Click</Button>
```

### Tailwind Classes via className

```tsx
<Card className="max-w-md mx-auto">...</Card>
```

### Add a New Variant

```tsx
// components/ui/button.tsx
warning: 'bg-warning text-warning-foreground hover:bg-warning/90',
```

### Wrapper Components

```tsx
export function ConfirmDialog({ title, description, onConfirm, children }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Confirm</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

## Checking for Updates

```bash
npx shadcn@latest add button --diff
npx shadcn@latest add button --dry-run
npx shadcn@latest add button --diff button.tsx
```

See the smart merge workflow in `SKILL.md` when the user has local component changes.