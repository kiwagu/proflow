---
title: Custom Components - Runtime, Styling, and Troubleshooting
description: Use when: using Payload admin hooks, handling i18n/config in custom components, styling admin extensions, or debugging performance and runtime issues.
tags: [payload, components, hooks, styling, troubleshooting]
---

# Payload Custom Components: Runtime, Styling, and Troubleshooting

## Pyramid Layer

- Layer: L3 Payload router.

## Use This When

- Load this after the custom-components router when the component is already registered and the task is about hooks, translations, styling, or debugging behavior.
- Use this file to choose the narrowest runtime leaf before loading examples.

## Stop Here If

- Stop here once the task is clearly about admin hooks/data access or styling/performance/troubleshooting.

## Descend To

- Admin hooks, config, i18n, and data access: `/.cursor/rules/components-admin-hooks-and-data-access.md`
- Styling, performance, and troubleshooting: `/.cursor/rules/components-styling-performance-and-troubleshooting.md`
- Return to `/.cursor/rules/components.md` for sibling registration or slot guidance.

Runtime component work now splits into two narrow concerns:

1. Admin hooks, config, i18n, and data access.
2. Styling, performance, and troubleshooting.

Load only the matching leaf above.