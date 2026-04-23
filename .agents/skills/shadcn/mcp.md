# shadcn MCP Server

## Pyramid Layer

- Layer: L2 reference.

## Use This When

- Load this after the shadcn router when the task needs registry search/view/install through MCP instead of direct CLI commands.

## Stop Here If

- Stop once the required MCP tool or registry flow is identified.

## Descend To

- Continue within this file for MCP setup and tool shapes.
- Return to `/.agents/skills/shadcn/SKILL.md` if the task broadens into CLI, theming, or component rules.

The CLI includes an MCP server that lets AI assistants search, browse, view, and install components from registries.

---

## Setup

```bash
shadcn mcp        # start the MCP server (stdio)
shadcn mcp init   # write config for your editor
```

Editor config files:

| Editor | Config file |
|--------|------------|
| Claude Code | `.mcp.json` |
| Cursor | `.cursor/mcp.json` |
| VS Code | `.vscode/mcp.json` |
| OpenCode | `opencode.json` |
| Codex | `~/.codex/config.toml` (manual) |

---

## Tools

> **Tip:** MCP tools handle registry operations (search, view, install). For project configuration (aliases, framework, Tailwind version), use `npx shadcn@latest info` — there is no MCP equivalent.

### `shadcn:get_project_registries`

Returns registry names from `components.json`. Errors if no `components.json` exists.

**Input:** none

### `shadcn:list_items_in_registries`

Lists all items from one or more registries.

**Input:** `registries` (string[]), `limit` (number, optional), `offset` (number, optional)

### `shadcn:search_items_in_registries`

Fuzzy search across registries.

**Input:** `registries` (string[]), `query` (string), `limit` (number, optional), `offset` (number, optional)

### `shadcn:view_items_in_registries`

View item details including full file contents.

**Input:** `items` (string[]) — e.g. `["@shadcn/button", "@shadcn/card"]`

### `shadcn:get_item_examples_from_registries`

Find usage examples and demos with source code.

**Input:** `registries` (string[]), `query` (string) — e.g. `"accordion-demo"`, `"button example"`

### `shadcn:get_add_command_for_items`

Returns the CLI install command.

**Input:** `items` (string[]) — e.g. `["@shadcn/button"]`

### `shadcn:get_audit_checklist`

Returns a checklist for verifying components (imports, deps, lint, TypeScript).

**Input:** none

---

## Configuring Registries

Registries are set in `components.json`. The `@shadcn` registry is always built-in.

```json
{
  "registries": {
    "@acme": "https://acme.com/r/{name}.json",
    "@private": {
      "url": "https://private.com/r/{name}.json",
      "headers": { "Authorization": "Bearer ${MY_TOKEN}" }
    }
  }
}
```

- Names must start with `@`.
- URLs must contain `{name}`.
- `${VAR}` references are resolved from environment variables.

Community registry index: `https://ui.shadcn.com/r/registries.json`
