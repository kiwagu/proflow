---
title: Custom Components in Payload CMS
description: Use when: customizing Payload admin UI, selecting component slots, wiring importMap paths, or debugging custom admin components.
tags: [payload, components, admin-ui, react]
---

# Custom Components in Payload CMS

## Pyramid Layer

- Layer: L2 Payload router.

## Use This When

- Load this after the Payload router when the task is specifically about custom admin components or Payload component slots.
- Use this file to choose the narrowest component sub-guide before loading examples.

## Stop Here If

- Stop here if the component concern is clearly registration, slot selection, or runtime behavior.

## Descend To

- Registration and server/client boundaries: `/.cursor/rules/components-registration-and-boundaries.md`
- Slots, overrides, and custom props: `/.cursor/rules/components-slots-and-overrides.md`
- Hooks, styling, i18n, performance, and troubleshooting: `/.cursor/rules/components-runtime-and-styling.md`
- Return to `/.cursor/rules/payload-overview.md` if the task expands into sibling Payload concerns.

Payload custom components split cleanly into three concerns:

1. Registration and runtime boundaries.
2. Slot selection and per-surface overrides.
3. Hooks, styling, performance, and troubleshooting.

Load only the matching sub-guide above.
