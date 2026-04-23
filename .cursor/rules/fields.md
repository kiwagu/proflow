---
title: Fields
description: Use when: defining Payload fields, field config, or field-level schema patterns.
tags: [payload, fields, validation, conditional]
---

# Payload CMS Fields

## Pyramid Layer

- Layer: L1 Payload router.

## Use This When

- Load this after the Payload router when the task is primarily about field types, conditional logic, validation, or field composition.
- Use this file to choose the narrowest field leaf before loading examples.

## Stop Here If

- Stop here once the task is clearly about simple editorial fields, structured/relational fields, or dynamic behavior.

## Descend To

- Editorial and simple field types: `/.cursor/rules/fields-editorial-and-simple-types.md`
- Relational and structured field types: `/.cursor/rules/fields-relational-and-structured-types.md`
- Validation and dynamic behavior: `/.cursor/rules/fields-validation-and-dynamic-behavior.md`
- Runtime narrowing: `/.cursor/rules/field-type-guards.md`
- Hooks for field behavior: `/.cursor/rules/hooks.md`

Field tasks split most cleanly into three buckets:

1. Editorial and simple field types.
2. Relational and structured field types.
3. Validation and dynamic behavior.

Load only the matching leaf above.
