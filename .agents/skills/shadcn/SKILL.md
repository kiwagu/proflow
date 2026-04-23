---
name: shadcn
description: Use when: a task touches shadcn/ui components, registries, presets, CLI workflows, or any project with a components.json file.
user-invocable: false
---

# shadcn/ui

## Pyramid Layer

- Layer: L0 shadcn router.

## Use This When

- Start here for any request that touches shadcn/ui components, registries, CLI usage, styling, composition, forms, icons, or presets.
- Use this file to choose the narrowest shadcn reference before loading examples or command details.

## Stop Here If

- Stop here if the principles and workflow below are enough to complete the task.
- Otherwise descend to one or two focused references instead of keeping the entire pack in context.

## Descend To

- Project context, component selection, and docs workflow: `/.agents/skills/shadcn/project-context-selection-and-docs.md`
- Install/update workflow and merge strategy: `/.agents/skills/shadcn/workflow-and-updating.md`
- CLI and update flow: `/.agents/skills/shadcn/cli.md`
- Theming and presets: `/.agents/skills/shadcn/customization.md`
- MCP workflow: `/.agents/skills/shadcn/mcp.md`
- Composition rules: `/.agents/skills/shadcn/rules/composition.md`
- Forms rules: `/.agents/skills/shadcn/rules/forms.md`
- Styling rules: `/.agents/skills/shadcn/rules/styling.md`
- Icons rules: `/.agents/skills/shadcn/rules/icons.md`
- Primitive differences: `/.agents/skills/shadcn/rules/base-vs-radix.md`

A framework for building ui, components and design systems. Components are added as source code to the user's project via the CLI. Current upstream docs cover both `radix` and `base` implementations, and the docs command can resolve either base explicitly.

> **IMPORTANT:** Run all CLI commands using the project's package runner: `npx shadcn@latest`, `pnpm dlx shadcn@latest`, or `bunx --bun shadcn@latest` — based on the project's `packageManager`. Examples below use `npx shadcn@latest` but substitute the correct runner for the project.

## Principles

1. **Use existing components first.** Use `npx shadcn@latest search` to check registries before writing custom UI. Check community registries too.
2. **Compose, don't reinvent.** Settings page = Tabs + Card + form controls. Dashboard = Sidebar + Card + Chart + Table.
3. **Use built-in variants before custom styles.** `variant="outline"`, `size="sm"`, etc.
4. **Use semantic colors.** `bg-primary`, `text-muted-foreground` — never raw values like `bg-blue-500`.
5. **For Next.js 16 async page data, keep auth/session reads behind `<Suspense>`.** If a page reads claims/session during render, use a Suspense boundary with fallback.
6. **When comparing primitive implementations, resolve docs for the active base first.** Use `npx shadcn@latest docs <component> --base base|radix` instead of guessing API differences.
7. **When component logic grows, prefer standard patterns.** Use composition, slots, adapters, policy helpers, or strategy/registry splits instead of growing a single component with mode-specific branching.

## Critical Rules

These rules are always enforced. Load the linked router or leaf instead of keeping large duplicated examples here.

### Styling & Tailwind → [styling.md](./rules/styling.md)

- Semantic tokens and variants go to `styling-semantic-tokens-and-variants.md`.
- Layout utilities and overlay stacking go to `styling-layout-utilities-and-stacking.md`.

### Forms & Inputs → [forms.md](./rules/forms.md)

- Layout, validation, and grouped fields go to `forms-layout-validation-and-groups.md`.
- Input groups and small choice controls go to `forms-input-groups-and-choice-controls.md`.

### Component Structure → [composition.md](./rules/composition.md)

- Overlay and structure contracts go to `composition-overlays-and-structure.md`.
- Feedback, empty states, and utility components go to `composition-feedback-empty-and-utilities.md`.

### Use Components, Not Custom Markup → [composition.md](./rules/composition.md)

- Prefer existing components. The concrete mappings live in `composition-feedback-empty-and-utilities.md`.

### Icons → [icons.md](./rules/icons.md)

- Use `data-icon` in buttons, avoid icon sizing classes, and pass icon objects rather than string keys.

### CLI

- **Never decode or fetch preset codes manually.** Pass them directly to `npx shadcn@latest init --preset <code>` for project setup or `npx shadcn@latest apply --preset <code>` for an existing project.

## Fast Routing Hints

- Need current project fields, component family selection, or docs URLs: load `project-context-selection-and-docs.md`.
- Need install, review, merge, or update flow: load `workflow-and-updating.md`.
- Need exact commands: go to the CLI router and then its narrow leaves.

## Detailed References

- [rules/forms.md](./rules/forms.md) — FieldGroup, Field, InputGroup, ToggleGroup, FieldSet, validation states
- [rules/composition.md](./rules/composition.md) — Groups, overlays, Card, Tabs, Avatar, Alert, Empty, Toast, Separator, Skeleton, Badge, Button loading
- [rules/icons.md](./rules/icons.md) — data-icon, icon sizing, passing icons as objects
- [rules/styling.md](./rules/styling.md) — Semantic colors, variants, className, spacing, size, truncate, dark mode, cn(), z-index
- [rules/base-vs-radix.md](./rules/base-vs-radix.md) — asChild vs render, Select, ToggleGroup, Slider, Accordion
- [cli.md](./cli.md) — Commands, flags, presets, templates
- [customization.md](./customization.md) — Theming, CSS variables, extending components
