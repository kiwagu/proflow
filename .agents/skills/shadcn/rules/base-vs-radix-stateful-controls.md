# Base vs Radix: Toggle, Slider, and Accordion

## Pyramid Layer

- Layer: L3 rule leaf.

## Use This When

- Load this after the primitive-differences router when the mismatch is about `ToggleGroup`, `Slider`, or `Accordion` state and prop shapes.

## Stop Here If

- Stop once the control-specific prop contract is clear.

## Descend To

- Return to `/.agents/skills/shadcn/rules/base-vs-radix.md` for trigger or select siblings.

## ToggleGroup

Base uses a `multiple` boolean prop. Radix uses `type="single"` or `type="multiple"`.

```tsx
<ToggleGroup defaultValue={['daily']} spacing={2}>
  <ToggleGroupItem value="daily">Daily</ToggleGroupItem>
</ToggleGroup>
```

```tsx
<ToggleGroup type="single" defaultValue="daily" spacing={2}>
  <ToggleGroupItem value="daily">Daily</ToggleGroupItem>
</ToggleGroup>
```

For controlled single values, base wraps and unwraps arrays while radix uses a plain string.

## Slider

Base accepts a plain number for a single thumb. Radix always requires an array.

```tsx
<Slider defaultValue={50} max={100} step={1} />
```

```tsx
<Slider defaultValue={[50]} max={100} step={1} />
```

Both use arrays for range sliders.

## Accordion

Radix requires `type="single"` or `type="multiple"` and supports `collapsible`. Base uses no `type` prop, uses `multiple`, and `defaultValue` is always an array.

```tsx
<Accordion defaultValue={['item-1']}>
  <AccordionItem value="item-1">...</AccordionItem>
</Accordion>
```

```tsx
<Accordion type="single" collapsible defaultValue="item-1">
  <AccordionItem value="item-1">...</AccordionItem>
</Accordion>
```