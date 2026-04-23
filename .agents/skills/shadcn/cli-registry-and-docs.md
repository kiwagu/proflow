# shadcn CLI: Registry Browsing and Docs

## Pyramid Layer

- Layer: L3 CLI leaf.

## Use This When

- Load this after the shadcn CLI router when the task is to search registries, inspect item metadata, or resolve documentation URLs.

## Stop Here If

- Stop once the exact browsing or docs command is clear.

## Descend To

- Return to `/.agents/skills/shadcn/cli.md` for install, project-info, build, or preset siblings.

## `search` — Search registries

```bash
npx shadcn@latest search <registries...> [options]
```

Fuzzy search across registries. Also aliased as `npx shadcn@latest list`.

| Flag                | Short | Description            | Default |
| ------------------- | ----- | ---------------------- | ------- |
| `--query <query>`   | `-q`  | Search query           | —       |
| `--limit <number>`  | `-l`  | Max items per registry | `100`   |
| `--offset <number>` | `-o`  | Items to skip          | `0`     |
| `--cwd <cwd>`       | `-c`  | Working directory      | current |

## `view` — View item details

```bash
npx shadcn@latest view <items...> [options]
```

Displays item info including file contents. Example: `npx shadcn@latest view @shadcn/button`.

Use `view` when the user wants registry metadata without project-specific diffing. If they want to preview project changes, prefer `add --dry-run`, `--diff`, or `--view`.

## `docs` — Get component documentation URLs

```bash
npx shadcn@latest docs <components...> [options]
```

Outputs resolved URLs for component documentation, examples, and API references.

Example output for `npx shadcn@latest docs input button`:

```text
base  radix

input
  docs      https://ui.shadcn.com/docs/components/radix/input
  examples  https://raw.githubusercontent.com/.../examples/input-example.tsx

button
  docs      https://ui.shadcn.com/docs/components/radix/button
  examples  https://raw.githubusercontent.com/.../examples/button-example.tsx
```

Some components include an `api` link to the underlying library.

| Flag          | Short | Description                                             | Default |
| ------------- | ----- | ------------------------------------------------------- | ------- |
| `--cwd <cwd>` | `-c`  | Working directory                                       | current |
| `--base`      | `-b`  | Resolve docs for `base` or `radix`; defaults to project | project |
| `--json`      |       | Output structured JSON                                  | `false` |

Use `--base` to compare the two primitive libraries explicitly. Upstream docs now publish dedicated `base` and `radix` pages for components.

## `diff` — Check for updates

Do not use this command. Use `npx shadcn@latest add --diff` instead.