# shadcn CLI: Project Info, Build, Presets, and Migrations

## Pyramid Layer

- Layer: L3 CLI leaf.

## Use This When

- Load this after the shadcn CLI router when the task is to inspect project configuration, build a registry, work with templates and presets, or run a CLI migration.

## Stop Here If

- Stop once the exact info, build, template, preset, or migration workflow is clear.

## Descend To

- Return to `/.agents/skills/shadcn/cli.md` for install or registry-browsing siblings.

## `info` — Project information

```bash
npx shadcn@latest info [options]
```

Displays project info and `components.json` configuration. Run this first to discover the project's framework, aliases, Tailwind version, and resolved paths.

| Flag          | Short | Description       | Default |
| ------------- | ----- | ----------------- | ------- |
| `--cwd <cwd>` | `-c`  | Working directory | current |
| `--json`      |       | Output structured JSON | `false` |

Key outputs include `project.*`, `config.*`, installed `components`, and resolved `links.*`. In practice this gives you framework, RSC mode, Tailwind version, alias paths, `base`, `style`, `iconLibrary`, `registries`, and concrete docs/example/source URLs.

## `build` — Build a custom registry

```bash
npx shadcn@latest build [registry] [options]
```

Builds `registry.json` into distributable JSON files. Default input is `./registry.json`; default output is `./public/r`.

| Flag              | Short | Description       | Default      |
| ----------------- | ----- | ----------------- | ------------ |
| `--output <path>` | `-o`  | Output directory  | `./public/r` |
| `--cwd <cwd>`     | `-c`  | Working directory | current      |

## Templates

| Value          | Framework      | Monorepo support |
| -------------- | -------------- | ---------------- |
| `next`         | Next.js        | Yes              |
| `vite`         | Vite           | Yes              |
| `start`        | TanStack Start | Yes              |
| `react-router` | React Router   | Yes              |
| `astro`        | Astro          | Yes              |
| `laravel`      | Laravel        | No               |

## `apply` — Apply a preset to an existing project

```bash
npx shadcn@latest apply [preset] [options]
```

Use `apply` when the project already exists and the task is to move onto a different preset without re-scaffolding the app.

| Flag          | Short | Description       | Default |
| ------------- | ----- | ----------------- | ------- |
| `--preset`    |       | Preset to apply   | —       |
| `--yes`       | `-y`  | Skip confirmation | `false` |
| `--cwd <cwd>` | `-c`  | Working directory | current |
| `--silent`    | `-s`  | Mute output       | `false` |

## Presets

Three ways to specify a preset via `--preset`:

1. Named: `--preset base-nova` or `--preset radix-nova`
2. Code: `--preset a2r6bw`
3. URL: `--preset "https://ui.shadcn.com/init?base=radix&style=nova&..."`

Never decode preset codes manually. Pass them directly to `npx shadcn@latest init --preset <code>`.

## Switching Presets

Ask the user first: reinstall, merge, or skip existing components.

- Config-only preset update on an existing project: `npx shadcn@latest apply --preset <code>`
- Re-install component sources from a preset: `npx shadcn@latest init --preset <code> --force --reinstall`
- Merge selectively: `npx shadcn@latest init --preset <code> --force --no-reinstall`, then inspect installed components and merge with `add --dry-run` and `add --diff`.
- Skip component re-installation: `npx shadcn@latest init --preset <code> --force --no-reinstall`

Always run preset commands inside the user's project directory. If you must use a scratch directory, pass `--base <current-base>` explicitly.

## `migrate` — Run supported code migrations

```bash
npx shadcn@latest migrate [migration] [path] [options]
```

Available migrations in the current CLI include `icons`, `radix`, and `rtl`.

| Flag          | Short | Description                      | Default |
| ------------- | ----- | -------------------------------- | ------- |
| `--cwd <cwd>` | `-c`  | Working directory                | current |
| `--list`      | `-l`  | List available migrations        | `false` |
| `--yes`       | `-y`  | Skip confirmation                | `false` |

Examples:

```bash
npx shadcn@latest migrate --list
npx shadcn@latest migrate rtl
npx shadcn@latest migrate radix "src/components/ui/**"
```