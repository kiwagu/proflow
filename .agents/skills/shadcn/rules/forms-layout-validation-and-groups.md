# Forms: Layout, Validation, and Groups

## Pyramid Layer

- Layer: L3 rule leaf.

## Use This When

- Load this after the forms router when the task is about overall form structure, grouped controls, schema-driven validation, or field state wiring.

## Stop Here If

- Stop once the layout or validation pattern is clear.

## Descend To

- Return to `/.agents/skills/shadcn/rules/forms.md` for input-group or control-choice siblings.

## FieldGroup and Field

Always use `FieldGroup` + `Field`, never raw `div` with `space-y-*`.

```tsx
<FieldGroup>
  <Field>
    <FieldLabel htmlFor="email">Email</FieldLabel>
    <Input id="email" type="email" />
  </Field>
  <Field>
    <FieldLabel htmlFor="password">Password</FieldLabel>
    <Input id="password" type="password" />
  </Field>
</FieldGroup>
```

Use `Field orientation="horizontal"` for settings pages. Use `FieldLabel className="sr-only"` for visually hidden labels.

## TanStack Form and Schema Validation

For new interactive forms, prefer TanStack Form with schema validation such as Zod.

Use the standard field pattern with validation state wiring:

- `FieldGroup` + `Field` for structure
- `FieldError` for error output
- `data-invalid` on `Field`
- `aria-invalid` on the control

In monorepos with shared UI wrappers, import TanStack form APIs through the shared UI package re-export when provided.

## FieldSet and FieldLegend

Use `FieldSet` + `FieldLegend` for related checkboxes, radios, or switches.

```tsx
<FieldSet>
  <FieldLegend variant="label">Preferences</FieldLegend>
  <FieldDescription>Select all that apply.</FieldDescription>
  <FieldGroup className="gap-3">
    <Field orientation="horizontal">
      <Checkbox id="dark" />
      <FieldLabel htmlFor="dark" className="font-normal">Dark mode</FieldLabel>
    </Field>
  </FieldGroup>
</FieldSet>
```

## Validation and Disabled States

`data-invalid` and `data-disabled` style the field. `aria-invalid` and `disabled` style the control.

```tsx
<Field data-invalid>
  <FieldLabel htmlFor="email">Email</FieldLabel>
  <Input id="email" aria-invalid />
  <FieldDescription>Invalid email address.</FieldDescription>
</Field>
```

```tsx
<Field data-disabled>
  <FieldLabel htmlFor="email">Email</FieldLabel>
  <Input id="email" disabled />
</Field>
```

This pattern applies to `Input`, `Textarea`, `Select`, `Checkbox`, `RadioGroupItem`, `Switch`, `Slider`, `NativeSelect`, and `InputOTP`.