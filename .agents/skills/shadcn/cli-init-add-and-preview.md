# shadcn CLI: Init, Add, and Preview

## Pyramid Layer

- Layer: L3 CLI leaf.

## Use This When

- Load this after the shadcn CLI router when the task is to initialize a project, add components, or preview install changes before writing files.

## Stop Here If

- Stop once the exact `init` or `add` command and preview mode are clear.

## Descend To

- Return to `/.agents/skills/shadcn/cli.md` for registry browsing, docs, info, build, or preset siblings.

Configuration is read from `components.json`.

> **IMPORTANT:** Always run commands using the project's package runner: `npx shadcn@latest`, `pnpm dlx shadcn@latest`, or `bunx --bun shadcn@latest`. Check `packageManager` from project context to choose the right one. Examples below use `npx shadcn@latest` but substitute the correct runner for the project.

> **IMPORTANT:** Only use the flags documented below. Do not invent or guess flags.

## `init` — Initialize or create a project

```bash
npx shadcn@latest init [components...] [options]
```

Initializes shadcn/ui in an existing project or creates a new project when `--name` is provided.

| Flag                    | Short | Description                                               | Default |
| ----------------------- | ----- | --------------------------------------------------------- | ------- |
| `--template <template>` | `-t`  | Template (next, start, vite, react-router, laravel, astro) | —       |
| `--base <base>`         | `-b`  | Component library to use (`radix` or `base`)               | —       |
| `--preset [name]`       | `-p`  | Preset configuration (named, code, or URL)                | —       |
| `--yes`                 | `-y`  | Skip confirmation prompt                                  | `true`  |
| `--defaults`            | `-d`  | Use defaults (`--template=next --preset=base-nova`)       | `false` |
| `--force`               | `-f`  | Force overwrite existing configuration                    | `false` |
| `--cwd <cwd>`           | `-c`  | Working directory                                         | current |
| `--name <name>`         | `-n`  | Name for new project                                      | —       |
| `--silent`              | `-s`  | Mute output                                               | `false` |
| `--css-variables`       |       | Use CSS variables for theming                             | `true`  |
| `--no-css-variables`    |       | Disable CSS variables for theming                         | —       |
| `--rtl`                 |       | Enable RTL support                                        | —       |
| `--no-rtl`              |       | Disable RTL support                                       | —       |
| `--reinstall`           |       | Re-install existing UI components                         | `false` |
| `--no-reinstall`        |       | Do not re-install existing UI components                  | —       |
| `--monorepo`            |       | Scaffold a monorepo project                               | —       |
| `--no-monorepo`         |       | Skip the monorepo prompt                                  | —       |

`npx shadcn@latest create` is an alias for `npx shadcn@latest init`. Prefer `create` in prose when the task is about scaffolding a new project from scratch.

## `add` — Add components

> **IMPORTANT:** To compare local components against upstream or to preview changes, always use `npx shadcn@latest add <component> --dry-run`, `--diff`, or `--view`. Never fetch raw files manually.

```bash
npx shadcn@latest add [components...] [options]
```

Accepts component names, registry-prefixed names, URLs, or local paths.

| Flag            | Short | Description                                                                                                          | Default |
| --------------- | ----- | -------------------------------------------------------------------------------------------------------------------- | ------- |
| `--yes`         | `-y`  | Skip confirmation prompt                                                                                             | `false` |
| `--overwrite`   | `-o`  | Overwrite existing files                                                                                             | `false` |
| `--cwd <cwd>`   | `-c`  | Working directory                                                                                                    | current |
| `--all`         | `-a`  | Add all available components                                                                                         | `false` |
| `--path <path>` | `-p`  | Target path for the component                                                                                        | —       |
| `--silent`      | `-s`  | Mute output                                                                                                          | `false` |
| `--dry-run`     |       | Preview all changes without writing files                                                                            | `false` |
| `--diff [path]` |       | Show diffs. Without a path, shows the first 5 files. With a path, shows that file only.                            | —       |
| `--view [path]` |       | Show file contents. Without a path, shows the first 5 files. With a path, shows that file only.                    | —       |

## Dry-Run and Preview Mode

Use `--dry-run` to preview what `add` would do without writing any files. `--diff` and `--view` both imply `--dry-run`.

```bash
npx shadcn@latest add button --dry-run
npx shadcn@latest add button --diff
npx shadcn@latest add button --diff button.tsx
npx shadcn@latest add button --view
npx shadcn@latest add button --view button.tsx
npx shadcn@latest add https://api.npoint.io/abc123 --dry-run
npx shadcn@latest add button --diff globals.css
```

Use preview mode when the user asks what will change, wants to inspect third-party registry code, or needs to review CSS diffs before install.

## Smart Merge from Upstream

See [Updating Components in SKILL.md](./SKILL.md#updating-components) for the full workflow.