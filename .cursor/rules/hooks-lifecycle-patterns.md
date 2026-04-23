---
title: Hooks - Lifecycle Patterns
description: Use when: implementing standard Payload collection or field hooks such as beforeValidate, beforeChange, afterChange, afterRead, or beforeDelete.
tags: [payload, hooks, lifecycle, collections, fields]
---

# Payload Hooks: Lifecycle Patterns

## Pyramid Layer

- Layer: L2 Payload leaf.

## Use This When

- Load this after the hooks router when the question is which hook lifecycle phase should own the behavior.

## Stop Here If

- Stop once the correct lifecycle phase is chosen.

## Descend To

- Return to `/.cursor/rules/hooks.md` for context or side-effect siblings.

## Collection Hooks

```typescript
export const Posts: CollectionConfig = {
  slug: 'posts',
  hooks: {
    beforeValidate: [
      async ({ data, operation }) => {
        if (operation === 'create') {
          data.slug = slugify(data.title)
        }
        return data
      },
    ],
    beforeChange: [
      async ({ data, operation }) => {
        if (operation === 'update' && data.status === 'published') {
          data.publishedAt = new Date()
        }
        return data
      },
    ],
    afterChange: [
      async ({ doc, operation, context }) => {
        if (context.skipNotification) return doc
        if (operation === 'create') {
          await sendNotification(doc)
        }
        return doc
      },
    ],
    afterRead: [
      async ({ doc }) => {
        doc.viewCount = await getViewCount(doc.id)
        return doc
      },
    ],
    beforeDelete: [
      async ({ req, id }) => {
        await req.payload.delete({
          collection: 'comments',
          where: { post: { equals: id } },
          req,
        })
      },
    ],
  },
}
```

## Field Hooks

```typescript
import type { FieldHook } from 'payload'

const beforeValidateHook: FieldHook = ({ value }) => value.trim().toLowerCase()

const afterReadHook: FieldHook = ({ value, req }) => {
  if (!req.user?.roles?.includes('admin')) {
    return value.replace(/(.{2})(.*)(@.*)/, '$1***$3')
  }
  return value
}
```

## beforeOperation

Use `beforeOperation` when you need to modify the operation arguments themselves or gate behavior before the collection operation begins.

```typescript
import type { CollectionBeforeOperationHook } from 'payload'

const beforeOperationHook: CollectionBeforeOperationHook = async ({
  args,
  operation,
}) => {
  if (operation === 'read') {
    return {
      ...args,
      depth: 1,
    }
  }

  return args
}
```

## Hook Selection Rules

1. Use `beforeOperation` when you need to alter operation arguments before the action starts.
2. Use `beforeValidate` for normalization.
3. Use `beforeChange` for persistence-time business logic.
4. Use `afterChange` for side effects.
5. Use `afterRead` for derived read-time data.