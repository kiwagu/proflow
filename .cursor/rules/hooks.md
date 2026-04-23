---
title: Hooks
description: Use when: adding or debugging Payload collection hooks, field hooks, or request-context patterns.
tags: [payload, hooks, lifecycle, context]
---

# Payload CMS Hooks

## Pyramid Layer

- Layer: L1 Payload router.

## Use This When

- Load this after the Payload router when the task is about collection hooks, field hooks, or trusted context passed through hooks.
- Use this file to choose the narrowest hooks leaf before loading examples.

## Stop Here If

- Stop here once the task is clearly about lifecycle selection or context/side-effect coordination.

## Descend To

- Lifecycle hook selection and examples: `/.cursor/rules/hooks-lifecycle-patterns.md`
- Context coordination and side effects: `/.cursor/rules/hooks-context-and-side-effects.md`
- Security constraints: `/.cursor/rules/security-critical.mdc`

Hook work now splits into two narrow concerns:

1. Lifecycle hook selection and standard examples.
2. Context sharing and safe side effects.

Load only the matching leaf above.
