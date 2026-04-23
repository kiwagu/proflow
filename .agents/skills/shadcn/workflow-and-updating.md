# shadcn: Workflow and Updating

## Pyramid Layer

- Layer: L1 workflow leaf.

## Use This When

- Load this after the shadcn router when the task is about the end-to-end component workflow, adding from registries, reviewing third-party code, or updating installed components while preserving local changes.

## Stop Here If

- Stop once the required workflow step or update strategy is clear.

## Descend To

- Install and preview commands: `/.agents/skills/shadcn/cli-init-add-and-preview.md`
- Registry browsing and docs lookup: `/.agents/skills/shadcn/cli-registry-and-docs.md`
- Return to `/.agents/skills/shadcn/SKILL.md` if the task broadens into component selection or style rules.

## Workflow

1. Get project context. Refresh with `npx shadcn@latest info` if needed.
2. Check installed components before running `add`.
3. Find components with `npx shadcn@latest search`.
4. Get docs and examples with `npx shadcn@latest docs <component>`. Use `--base` when comparing `base` and `radix` implementations.
5. Install or update with `npx shadcn@latest add`.
6. Fix imports in third-party components when their aliases do not match the project.
7. Review added files for composition, imports, icon library, and rule compliance.
8. Never guess the registry; ask when the source registry is not specified.
9. For preset switches on an existing project, prefer `npx shadcn@latest apply --preset <code>` for configuration updates. If component source files also need to change, confirm whether to reinstall, merge, or skip existing components.

## Updating Components

When the user wants upstream updates while preserving local changes, use the CLI diff workflow instead of fetching raw files.

1. Run `npx shadcn@latest add <component> --dry-run`.
2. For each affected file, run `npx shadcn@latest add <component> --diff <file>`.
3. Merge selectively when local changes exist.
4. Never use `--overwrite` without explicit approval.

## Quick Reference

```bash
npx shadcn@latest create --name my-app --base radix --preset radix-nova
npx shadcn@latest init --defaults
npx shadcn@latest apply --preset a2r6bw
npx shadcn@latest add button card dialog
npx shadcn@latest add button --dry-run
npx shadcn@latest add button --diff button.tsx
npx shadcn@latest search @shadcn -q "sidebar"
npx shadcn@latest docs button dialog select --base radix
npx shadcn@latest docs empty --base base --json
npx shadcn@latest view @shadcn/button
```

The current CLI supports `create` as an alias for `init`, `apply` for existing-project preset changes, and templates `next`, `vite`, `start`, `react-router`, `astro`, and `laravel`.