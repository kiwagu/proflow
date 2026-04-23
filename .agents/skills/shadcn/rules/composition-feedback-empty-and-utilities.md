# Composition: Feedback, Empty States, and Utility Components

## Pyramid Layer

- Layer: L3 rule leaf.

## Use This When

- Load this after the composition router when the task is about alerts, empty states, toast notifications, separators, skeletons, or badges.

## Stop Here If

- Stop once the feedback or utility-component pattern is clear.

## Descend To

- Return to `/.agents/skills/shadcn/rules/composition.md` for overlay or structure siblings.

## Callouts Use Alert

```tsx
<Alert>
  <AlertTitle>Warning</AlertTitle>
  <AlertDescription>Something needs attention.</AlertDescription>
</Alert>
```

## Empty States Use Empty

`Empty` is now a first-class documented component in upstream shadcn docs for both `radix` and `base`, so prefer the canonical composition before inventing custom empty-state wrappers.

```tsx
<Empty>
  <EmptyHeader>
    <EmptyMedia variant="icon"><FolderIcon /></EmptyMedia>
    <EmptyTitle>No projects yet</EmptyTitle>
    <EmptyDescription>Get started by creating a new project.</EmptyDescription>
  </EmptyHeader>
  <EmptyContent>
    <Button>Create Project</Button>
  </EmptyContent>
</Empty>
```

## Toast Notifications Use sonner

```tsx
import { toast } from 'sonner'

toast.success('Changes saved.')
toast.error('Something went wrong.')
```

## Use Existing Utility Components

| Instead of | Use |
| --- | --- |
| `<hr>` or bordered divs | `<Separator />` |
| Custom pulse placeholders | `<Skeleton />` |
| Custom rounded status spans | `<Badge />` |

Prefer the existing component before custom markup.