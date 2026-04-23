---
title: Custom Components - Registration and Boundaries
description: Use when: wiring Payload custom components, configuring importMap/baseDir, or deciding between server and client component boundaries.
tags: [payload, components, admin-ui, import-map, react]
---

# Payload Custom Components: Registration and Boundaries

## Pyramid Layer

- Layer: L3 Payload router.

## Use This When

- Load this after the custom-components router when the task is about component file paths, import map setup, component config objects, or server versus client boundaries.
- Use this file to choose the narrowest registration leaf before loading examples.

## Stop Here If

- Stop here once the task is clearly about path/import-map wiring or server/client boundaries and types.

## Descend To

- Paths, export wiring, and importMap: `/.cursor/rules/components-paths-and-import-map.md`
- Server/client boundaries, props, and types: `/.cursor/rules/components-server-client-boundaries-and-types.md`
- Return to `/.cursor/rules/components.md` for sibling component-slot or runtime guidance.

Registration work now splits into two narrow concerns:

1. Paths, export wiring, and import-map resolution.
2. Server/client boundaries, props, and type contracts.

Load only the matching leaf above.