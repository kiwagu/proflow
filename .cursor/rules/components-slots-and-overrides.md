---
title: Custom Components - Slots and Overrides
description: Use when: choosing Payload admin component slots, overriding collection/global/field UI, or passing custom props into admin components.
tags: [payload, components, admin-ui, slots, fields]
---

# Payload Custom Components: Slots and Overrides

## Pyramid Layer

- Layer: L3 Payload router.

## Use This When

- Load this after the custom-components router when the task is about where a component should mount in the admin UI.
- Use this file to choose the narrowest slot/props leaf before loading examples.

## Stop Here If

- Stop here once the task is clearly about root/resource slots or field slots and props.

## Descend To

- Root, collection, and global slots: `/.cursor/rules/components-root-and-resource-slots.md`
- Field slots and custom props: `/.cursor/rules/components-field-slots-and-props.md`
- Return to `/.cursor/rules/components.md` for sibling wiring or runtime guidance.

Slot work now splits into two narrow concerns:

1. Root, collection, and global slot surfaces.
2. Field slots and custom prop contracts.

Load only the matching leaf above.