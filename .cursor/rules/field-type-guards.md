---
title: Field Type Guards
description: Use when: narrowing Payload field unions or adding runtime field-type guards.
tags: [payload, typescript, type-guards, fields]
---

# Payload Field Type Guards

## Pyramid Layer

- Layer: L2 Payload router.

## Use This When

- Load this after the Payload router or fields guide when the task needs runtime field narrowing helpers.
- Use this file to choose the narrowest field-guard leaf before loading examples.

## Stop Here If

- Stop here once the task is clearly about primitive guard selection or combined traversal patterns.

## Descend To

- Primitive and capability guards: `/.cursor/rules/field-guard-primitives-and-capabilities.md`
- Traversal and composed guard patterns: `/.cursor/rules/field-guard-traversal-and-patterns.md`
- Return to `/.cursor/rules/fields.md` or `/.cursor/rules/payload-overview.md` if the task broadens.

Field guard work now splits into two narrow concerns:

1. Primitive guards and capability checks.
2. Traversal and composed runtime patterns.

Load only the matching leaf above.
