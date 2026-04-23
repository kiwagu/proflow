# Base vs Radix: Select APIs

## Pyramid Layer

- Layer: L3 rule leaf.

## Use This When

- Load this after the primitive-differences router when the mismatch is about `Select` items, placeholders, positioning, multiple selection, or object values.

## Stop Here If

- Stop once the `Select` API difference is clear.

## Descend To

- Return to `/.agents/skills/shadcn/rules/base-vs-radix.md` for trigger or control siblings.

## Items Prop

Base requires an `items` prop on the root. Radix uses inline JSX only.

```tsx
const items = [
  { label: 'Select a fruit', value: null },
  { label: 'Apple', value: 'apple' },
  { label: 'Banana', value: 'banana' },
]

<Select items={items}>
  <SelectTrigger>
    <SelectValue />
  </SelectTrigger>
</Select>
```

```tsx
<Select>
  <SelectTrigger>
    <SelectValue placeholder="Select a fruit" />
  </SelectTrigger>
</Select>
```

## Placeholder and Positioning

Base uses a `{ value: null }` item for placeholders and `alignItemWithTrigger` for positioning. Radix uses `<SelectValue placeholder="..." />` and `position`.

## Multiple Selection and Object Values in Base

Base supports `multiple`, render-function children on `SelectValue`, and object values with `itemToStringValue`. Radix is single-select with string values only.

```tsx
<Select items={items} multiple defaultValue={[]}>
  <SelectTrigger>
    <SelectValue>
      {(value: string[]) => value.length === 0 ? 'Select fruits' : `${value.length} selected`}
    </SelectValue>
  </SelectTrigger>
</Select>
```

```tsx
<Select defaultValue={plans[0]} itemToStringValue={(plan) => plan.name}>
  <SelectTrigger>
    <SelectValue>{(value) => value.name}</SelectValue>
  </SelectTrigger>
</Select>
```