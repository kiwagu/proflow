# Base vs Radix

## Pyramid Layer

- Layer: L2 primitive-differences router.

## Use This When

- Load this after the shadcn router when a component API differs between `base` and `radix` primitives.
- Use this file to choose the narrowest primitive-difference leaf before loading examples.

## Stop Here If

- Stop here once the mismatch is clearly about trigger composition, `Select`, or control state props.

## Descend To

- Trigger composition and non-button render contracts: `/.agents/skills/shadcn/rules/base-vs-radix-trigger-composition.md`
- `Select` items, placeholder, multiple, and object values: `/.agents/skills/shadcn/rules/base-vs-radix-select.md`
- `ToggleGroup`, `Slider`, and `Accordion` state props: `/.agents/skills/shadcn/rules/base-vs-radix-stateful-controls.md`
- Return to `/.agents/skills/shadcn/SKILL.md` if the task expands beyond primitive differences.

API differences between `base` and `radix`. Check the `base` field from `npx shadcn@latest info`.

Primitive API differences now split into three narrow concerns:

1. Trigger composition and non-button render contracts.
2. `Select` items, placeholder, and multi-value behavior.
3. `ToggleGroup`, `Slider`, and `Accordion` state props.

Load only the matching leaf above.
