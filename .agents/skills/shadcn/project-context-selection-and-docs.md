# shadcn: Project Context, Selection, and Docs

## Pyramid Layer

- Layer: L1 reference leaf.

## Use This When

- Load this after the shadcn router when the task is to understand the current project configuration, pick the right component family, or resolve docs/example URLs before implementation.

## Stop Here If

- Stop once the relevant project fields, component family, or docs workflow are clear.

## Descend To

- CLI project info and presets: `/.agents/skills/shadcn/cli-project-info-build-and-presets.md`
- Return to `/.agents/skills/shadcn/SKILL.md` if the task broadens into installation, styling, or composition rules.

## Current Project Context

```json
!`npx shadcn@latest info --json`
```

Use `npx shadcn@latest docs <component>` to get documentation and example URLs for any component.

## Principles

1. Use existing components first.
2. Compose instead of reinventing.
3. Use built-in variants before custom styles.
4. Use semantic colors.
5. If a Next.js page reads async auth or session data during render, keep it behind `<Suspense>`.
6. Use `docs --base` when you need to compare the `base` and `radix` implementations explicitly.

## Component Selection

| Need | Use |
| --- | --- |
| Button or action | `Button` |
| Form inputs | `Input`, `Select`, `Combobox`, `Switch`, `Checkbox`, `RadioGroup`, `Textarea`, `InputOTP`, `Slider` |
| Toggle between 2–5 options | `ToggleGroup` + `ToggleGroupItem` |
| Data display | `Table`, `Card`, `Badge`, `Avatar` |
| Navigation | `Sidebar`, `NavigationMenu`, `Breadcrumb`, `Tabs`, `Pagination` |
| Overlays | `Dialog`, `Sheet`, `Drawer`, `AlertDialog` |
| Feedback | `sonner`, `Alert`, `Progress`, `Skeleton`, `Spinner` |
| Charts | `Chart` |
| Empty states | `Empty` |
| Menus | `DropdownMenu`, `ContextMenu`, `Menubar` |
| Tooltips or info | `Tooltip`, `HoverCard`, `Popover` |

## Key Project Fields

- `project.framework` and `project.frameworkVersion`: framework-specific routing and file conventions.
- `project.rsc` and `config.rsc`: determines when `"use client"` is required.
- `project.tailwindVersion`: `v4` uses `@theme inline`; `v3` uses `tailwind.config.js`.
- `config.resolvedPaths.tailwindCss`: edit this file for CSS variables.
- `config.style`: visual treatment such as `new-york`.
- `config.base`: `radix` or `base`; affects component APIs and docs URLs.
- `config.iconLibrary`: determines icon imports.
- `config.aliases`: import aliases used by generated code.
- `config.resolvedPaths`: exact file-system destinations.
- `links.docs`, `links.components`, and `links.examples`: upstream docs and source templates resolved by the CLI.

Use the project's `packageManager` from `package.json` for non-shadcn dependency installs. It is not part of `shadcn info --json` output.

See `cli.md` and `icons.md` for deeper field-specific guidance.

## Docs and Examples

Run `npx shadcn@latest docs <components...>` to get documentation, examples, and API-reference URLs.

```bash
npx shadcn@latest docs button dialog select
npx shadcn@latest docs empty --base base
npx shadcn@latest docs button dialog --json
```

Use `--base base|radix` when comparing primitive implementations. Use `--json` when another tool needs structured output.

When creating, fixing, debugging, or using a component, get the docs URLs first rather than guessing the API.