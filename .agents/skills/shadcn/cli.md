# shadcn CLI Reference

## Pyramid Layer

- Layer: L2 CLI router.

## Use This When

- Load this after the shadcn router when the task needs exact CLI syntax, flags, or update/merge commands.
- Use this file to choose the narrowest CLI leaf before loading command details.

## Stop Here If

- Stop here once the task is clearly about install/preview flow, registry/docs browsing, or project info/build/presets/migrations.

## Descend To

- Init, add, dry-run, diff, and install preview: `/.agents/skills/shadcn/cli-init-add-and-preview.md`
- Search, view, docs, and registry browsing: `/.agents/skills/shadcn/cli-registry-and-docs.md`
- Info, build, templates, presets, and migrations: `/.agents/skills/shadcn/cli-project-info-build-and-presets.md`
- Return to `/.agents/skills/shadcn/SKILL.md` if the task broadens beyond CLI behavior.

Configuration is read from `components.json`.

> **IMPORTANT:** Always run commands using the project's package runner: `npx shadcn@latest`, `pnpm dlx shadcn@latest`, or `bunx --bun shadcn@latest`. Check `packageManager` from project context to choose the right one. Examples below use `npx shadcn@latest` but substitute the correct runner for the project.

> **IMPORTANT:** Only use the flags documented below. Do not invent or guess flags — if a flag isn't listed here, it doesn't exist. The CLI auto-detects the package manager from the project's lockfile; there is no `--package-manager` flag.

The CLI reference now splits into three narrow concerns:

1. Project init, component add flow, and preview modes.
2. Registry browsing and docs lookups.
3. Project info, build flow, templates, presets, and migrations.

Load only the matching leaf above.
