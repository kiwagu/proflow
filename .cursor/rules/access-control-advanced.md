---
title: Access Control - Advanced Patterns
description: Use when: standard Payload access guidance is insufficient and the task needs advanced context-aware policies, reusable factories, or access performance tuning.
tags: [payload, access-control, security, advanced, performance]
priority: high
---

# Advanced Access Control Patterns

## Pyramid Layer

- Layer: L2 Payload router.

## Use This When

- Load this after the Payload router when the task needs advanced access factories, time-based checks, subscription-aware logic, or context-aware access patterns.
- Use this file to choose the narrowest advanced-access leaf before loading detailed examples.

## Stop Here If

- Stop here if the task is clearly about policy shape, reusable factories, or performance/debugging.

## Descend To

- Context, time, and subscription patterns: `/.cursor/rules/access-control-context-and-subscription-patterns.md`
- Reusable factories and collection templates: `/.cursor/rules/access-control-factories-and-templates.md`
- Performance and debugging: `/.cursor/rules/access-control-performance-and-debugging.md`
- Return to `/.cursor/rules/payload-overview.md` if the task expands into sibling Payload domains.

Advanced access work usually falls into three buckets:

1. Context, date-window, and subscription-aware policy logic.
2. Reusable factories and collection templates.
3. Performance and debugging.

Load only the matching leaf above.
