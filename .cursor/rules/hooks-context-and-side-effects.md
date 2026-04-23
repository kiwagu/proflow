---
title: Hooks - Context and Side Effects
description: Use when: sharing data through hook context, preventing loops, revalidating Next.js paths, or coordinating expensive side effects in Payload hooks.
tags: [payload, hooks, context, revalidation, side-effects]
---

# Payload Hooks: Context and Side Effects

## Pyramid Layer

- Layer: L2 Payload leaf.

## Use This When

- Load this after the hooks router when the lifecycle phase is known and the remaining problem is coordination, context passing, or safe side effects.

## Stop Here If

- Stop once the context or side-effect strategy is clear.

## Descend To

- Security constraints: `/.cursor/rules/security-critical.mdc`
- Return to `/.cursor/rules/hooks.md` for lifecycle siblings.

## Hook Context

```typescript
export const Posts: CollectionConfig = {
  slug: 'posts',
  hooks: {
    beforeChange: [
      async ({ context }) => {
        context.expensiveData = await fetchExpensiveData()
      },
    ],
    afterChange: [
      async ({ context, doc }) => {
        await processData(doc, context.expensiveData)
      },
    ],
  },
}
```

Use context for per-request coordination and loop-prevention flags, not as a hidden global store.

When context is passed through a Local API operation, Payload makes it available both as the hook `context` argument and on `req.context`.

## Next.js Revalidation Pattern

```typescript
import type { CollectionAfterChangeHook } from 'payload'
import { revalidatePath } from 'next/cache'

export const revalidatePage: CollectionAfterChangeHook = ({
  doc,
  previousDoc,
  req: { payload, context },
}) => {
  if (!context.disableRevalidate) {
    if (doc._status === 'published') {
      const path = doc.slug === 'home' ? '/' : `/${doc.slug}`
      payload.logger.info(`Revalidating page at path: ${path}`)
      revalidatePath(path)
    }

    if (previousDoc?._status === 'published' && doc._status !== 'published') {
      const oldPath = previousDoc.slug === 'home' ? '/' : `/${previousDoc.slug}`
      revalidatePath(oldPath)
    }
  }

  return doc
}
```

## Small Side-Effect Pattern

```typescript
{
  name: 'publishedOn',
  type: 'date',
  hooks: {
    beforeChange: [
      ({ siblingData, value }) => {
        if (siblingData._status === 'published' && !value) {
          return new Date()
        }
        return value
      },
    ],
  },
}
```

## Rules

1. Store expensive intermediate work in `context` when multiple hooks need it.
2. Use context flags to prevent infinite loops.
3. Pass `req` through nested operations for transaction safety.
4. Keep side effects behind explicit conditions, especially revalidation and notifications.
5. Treat `context` as request-scoped coordination data, not durable state.