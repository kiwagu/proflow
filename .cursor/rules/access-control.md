---
title: Access Control
description: Use when: implementing standard Payload collection, field, or global access control rules.
tags: [payload, access-control, security, permissions, rbac]
---

# Payload CMS Access Control

## Pyramid Layer

- Layer: L1 Payload router.

## Use This When

- Load this after the Payload router for collection, field, or global access-control work.
- Use this file to choose the narrowest standard access-control leaf before loading examples.

## Stop Here If

- Stop here once the task is clearly about collection/global access, field or RBAC rules, or advanced policy patterns.

## Descend To

- Collection and global patterns: `/.cursor/rules/access-control-collection-patterns.md`
- Field, RBAC, and tenant patterns: `/.cursor/rules/access-control-field-rbac-and-tenant-patterns.md`
- Advanced patterns: `/.cursor/rules/access-control-advanced.md`
- Security pitfalls: `/.cursor/rules/security-critical.mdc`

Standard access work now splits into three buckets:

1. Collection and global access patterns.
2. Field access, RBAC, and standard tenant patterns.
3. Advanced policy patterns.

Load only the matching leaf above.
