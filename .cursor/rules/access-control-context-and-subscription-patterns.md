---
title: Access Control - Context and Subscription Patterns
description: Use when: implementing locale-aware, device-aware, IP-based, time-based, or subscription-based Payload access rules.
tags: [payload, access-control, security, subscriptions, context]
priority: high
---

# Advanced Access Control: Context and Subscription Patterns

## Pyramid Layer

- Layer: L3 Payload router.

## Use This When

- Load this after the advanced-access router when the access rule depends on runtime context, publish windows, or subscription state.
- Use this file to choose the narrowest context-vs-subscription leaf before loading examples.

## Stop Here If

- Stop here once the task is clearly about context/time constraints or subscription state.

## Descend To

- Context-aware and time-window patterns: `/.cursor/rules/access-control-context-and-time-patterns.md`
- Subscription-aware patterns: `/.cursor/rules/access-control-subscription-patterns.md`
- Return to `/.cursor/rules/access-control-advanced.md` for sibling factory/template or performance guidance.

Use query constraints where possible and reserve async access checks for decisions that cannot be expressed as indexed filters.

This branch now splits into two narrow concerns:

1. Context-aware and time-window constraints.
2. Subscription-aware access checks.

Load only the matching leaf above.