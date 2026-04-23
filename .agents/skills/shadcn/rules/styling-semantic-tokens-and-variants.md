# Styling: Semantic Tokens and Variants

## Pyramid Layer

- Layer: L3 rule leaf.

## Use This When

- Load this after the styling router when the task is about semantic colors, status indicators, or choosing built-in variants over ad-hoc classes.

## Stop Here If

- Stop once the semantic-token or variant rule is clear.

## Descend To

- Theme variables: `/.agents/skills/shadcn/customization-theme-variables-and-presets.md`
- Return to `/.agents/skills/shadcn/rules/styling.md` for layout-utility siblings.

## Semantic Colors

Prefer semantic tokens such as `bg-primary`, `text-primary-foreground`, and `text-muted-foreground`.

## No Raw Status Colors

For positive, negative, or status indicators, use `Badge` variants, semantic tokens like `text-destructive`, or a custom theme variable.

## Built-In Variants First

Prefer component variants such as `variant="outline"` over recreating the variant with manual classes.