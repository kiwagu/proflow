# Forms: Input Groups and Choice Controls

## Pyramid Layer

- Layer: L3 rule leaf.

## Use This When

- Load this after the forms router when the task is about choosing the right control, using `InputGroup`, or representing a small option set.

## Stop Here If

- Stop once the control choice or input-group pattern is clear.

## Descend To

- Primitive value-shape differences: `/.agents/skills/shadcn/rules/base-vs-radix-stateful-controls.md`
- Return to `/.agents/skills/shadcn/rules/forms.md` for layout or validation siblings.

## Choosing Form Controls

- Simple text input: `Input`
- Dropdown with predefined options: `Select`
- Searchable dropdown: `Combobox`
- Native HTML select: `native-select`
- Boolean toggle: `Switch` for settings, `Checkbox` for forms
- Single choice from a few options: `RadioGroup`
- Toggle between 2–5 options: `ToggleGroup` + `ToggleGroupItem`
- OTP or verification code: `InputOTP`
- Multi-line text: `Textarea`

## InputGroup Requires InputGroupInput or InputGroupTextarea

Never use raw `Input` or `Textarea` inside `InputGroup`.

```tsx
<InputGroup>
  <InputGroupInput placeholder="Search..." />
</InputGroup>
```

## Buttons Inside Inputs Use InputGroupAddon

Never place a `Button` directly inside or adjacent to an `Input` with custom positioning.

```tsx
<InputGroup>
  <InputGroupInput placeholder="Search..." />
  <InputGroupAddon>
    <Button size="icon">
      <SearchIcon data-icon="inline-start" />
    </Button>
  </InputGroupAddon>
</InputGroup>
```

## Small Option Sets Use ToggleGroup

Do not manually loop `Button` components with active state for small segmented choices.

```tsx
<ToggleGroup spacing={2}>
  <ToggleGroupItem value="daily">Daily</ToggleGroupItem>
  <ToggleGroupItem value="weekly">Weekly</ToggleGroupItem>
  <ToggleGroupItem value="monthly">Monthly</ToggleGroupItem>
</ToggleGroup>
```

Combine with `Field` for labelled toggle groups.

> Note: `defaultValue` and `type` or `multiple` props differ between base and radix. See `base-vs-radix-stateful-controls.md`.