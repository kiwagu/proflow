# Styling & Customization

## Pyramid Layer

- Layer: L2 styling router.

## Use This When

- Load this after the shadcn router when the task is specifically about semantic colors, variants, layout classes, spacing, truncation, or overlay stacking.
- Use this file to choose the narrowest styling leaf before loading examples.

## Stop Here If

- Stop here once the task is clearly about semantic tokens and variants or about layout utilities and overlay stacking.

## Descend To

- Semantic tokens, status colors, and built-in variants: `/.agents/skills/shadcn/rules/styling-semantic-tokens-and-variants.md`
- Layout utilities, spacing, `cn()`, and overlay stacking: `/.agents/skills/shadcn/rules/styling-layout-utilities-and-stacking.md`
- Load `/.agents/skills/shadcn/customization.md` for theming and CSS variables.
- Return to `/.agents/skills/shadcn/SKILL.md` if the task expands into forms, composition, icons, or CLI behavior.

See [customization.md](../customization.md) for theming, CSS variables, and adding custom colors.

Styling rules now split into two narrow concerns:

1. Semantic tokens, status colors, and built-in variants.
2. Layout utilities, spacing, `cn()`, and overlay stacking.

Load only the matching leaf above.
