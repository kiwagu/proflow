# Base vs Radix: Trigger and Composition APIs

## Pyramid Layer

- Layer: L3 rule leaf.

## Use This When

- Load this after the primitive-differences router when the mismatch is about `asChild` versus `render`, trigger composition, or non-button trigger elements.

## Stop Here If

- Stop once the trigger or composition contract is clear.

## Descend To

- Return to `/.agents/skills/shadcn/rules/base-vs-radix.md` for select or control siblings.

API differences between `base` and `radix`. Check the `base` field from `npx shadcn@latest info`.

## Composition: asChild versus render

Radix uses `asChild` to replace the default element. Base uses `render`. Do not wrap triggers in extra elements.

```tsx
<DialogTrigger asChild>
  <Button>Open</Button>
</DialogTrigger>
```

```tsx
<DialogTrigger render={<Button />}>Open</DialogTrigger>
```

This applies to trigger and close components such as `DialogTrigger`, `SheetTrigger`, `DropdownMenuTrigger`, `PopoverTrigger`, and `DialogClose`.

## Non-Button Trigger Elements in Base

When `render` changes an element to a non-button like `<a>` or `<span>`, add `nativeButton={false}`.

```tsx
<Button render={<a href="/docs" />} nativeButton={false}>
  Read the docs
</Button>
```

```tsx
<Button asChild>
  <a href="/docs">Read the docs</a>
</Button>
```

The same rule applies to base triggers whose `render` target is not a `Button`.