---
title: Collections
description: Use when: defining or refactoring Payload collections, collection config shape, or collection-level schema patterns.
tags: [payload, collections, auth, upload, drafts]
---

# Payload CMS Collections

## Pyramid Layer

- Layer: L1 Payload router.

## Use This When

- Load this after the Payload router when the task is primarily about collection shape, auth collections, uploads, drafts, or admin list behavior.
- Use this file to choose the narrowest collection leaf before loading examples.

## Stop Here If

- Stop here once the task is clearly about base/auth collection shape or about media, drafts, and globals.

## Descend To

- Core and auth collection patterns: `/.cursor/rules/collections-core-and-auth-patterns.md`
- Media, drafts, and globals: `/.cursor/rules/collections-media-drafts-and-globals.md`
- Fields: `/.cursor/rules/fields.md`
- Hooks: `/.cursor/rules/hooks.md`
- Access control: `/.cursor/rules/access-control.md`

Collection work now splits into two narrow concerns:

1. Base and auth collection patterns.
2. Media, draft/version, and global patterns.

Load only the matching leaf above.
