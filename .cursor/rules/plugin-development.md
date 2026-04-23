---
title: Plugin Development
description: Use when: creating or extending Payload CMS plugins with the repository's TypeScript patterns.
tags: [payload, plugins, architecture, patterns]
---

# Payload Plugin Development

## Pyramid Layer

- Layer: L2 Payload router.

## Use This When

- Load this after the Payload router when the task is specifically about building or extending a Payload plugin.
- Use this file to choose the narrowest plugin leaf before loading examples.

## Stop Here If

- Stop here once the task is clearly about plugin architecture, extension surfaces, or lifecycle safety.

## Descend To

- Architecture and config mutation: `/.cursor/rules/plugin-architecture-and-config-mutation.md`
- Hooks, field overrides, and admin surfaces: `/.cursor/rules/plugin-extension-surfaces.md`
- Disable behavior, onInit, and safety rules: `/.cursor/rules/plugin-lifecycle-and-safety.md`
- Return to `/.cursor/rules/payload-overview.md` if the task expands into sibling Payload concerns.

Plugin work splits into three narrow concerns:

1. Core plugin architecture and config mutation.
2. Extension surfaces such as hooks, admin components, and field overrides.
3. Lifecycle toggles and safety rules.

Load only the matching leaf above.
