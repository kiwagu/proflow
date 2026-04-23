---
title: Access Control - Collection Patterns
description: Use when: writing standard Payload collection or global access rules that return booleans or query constraints.
tags: [payload, access-control, collections, globals]
---

# Payload Access Control: Collection Patterns

## Pyramid Layer

- Layer: L2 Payload leaf.

## Use This When

- Load this after the access-control router when the task is about collection-level or global document access.

## Stop Here If

- Stop once the collection/global access shape is clear.

## Descend To

- Return to `/.cursor/rules/access-control.md` for field, RBAC, or tenant siblings.

## Access Layers

Collection-level access governs create, read, update, delete, and admin visibility for full documents.

```typescript
import type { Access, CollectionConfig } from 'payload'

export const Posts: CollectionConfig = {
  slug: 'posts',
  access: {
    create: ({ req: { user } }) => Boolean(user),
    read: ({ req: { user } }) => {
      if (user) return true
      return { status: { equals: 'published' } }
    },
    update: ({ req: { user } }) => {
      if (user?.roles?.includes('admin')) return true
      return { author: { equals: user?.id } }
    },
    delete: async ({ req, id }) => {
      const hasComments = await req.payload.count({
        collection: 'comments',
        where: { post: { equals: id } },
      })
      return hasComments === 0
    },
  },
}
```

## Common Patterns

```typescript
export const anyone: Access = () => true

export const authenticated: Access = ({ req: { user } }) => Boolean(user)

export const adminOnly: Access = ({ req: { user } }) => user?.roles?.includes('admin')

export const adminOrSelf: Access = ({ req: { user } }) => {
  if (user?.roles?.includes('admin')) return true
  return { id: { equals: user?.id } }
}

export const authenticatedOrPublished: Access = ({ req: { user } }) => {
  if (user) return true
  return { _status: { equals: 'published' } }
}
```

## Organization and Team Scoping

```typescript
export const organizationScoped: Access = ({ req: { user } }) => {
  if (user?.roles?.includes('admin')) return true

  return {
    organization: {
      equals: user?.organization,
    },
  }
}
```

Use collection access when the result should scope which records are visible, not merely whether a single field renders.