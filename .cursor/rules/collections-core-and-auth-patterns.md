---
title: Collections - Core and Auth Patterns
description: Use when: defining a basic Payload collection or auth collection, including RBAC-oriented user collections.
tags: [payload, collections, auth, rbac]
---

# Payload Collections: Core and Auth Patterns

## Pyramid Layer

- Layer: L2 Payload leaf.

## Use This When

- Load this after the collections router when the task is about the core collection shape or an auth collection.

## Stop Here If

- Stop once the base collection pattern is clear.

## Descend To

- Return to `/.cursor/rules/collections.md` for upload, draft, or global siblings.

## Basic Collection

```typescript
import type { CollectionConfig } from 'payload'

export const Posts: CollectionConfig = {
  slug: 'posts',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'author', 'status', 'createdAt'],
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', unique: true, index: true },
    { name: 'content', type: 'richText' },
    { name: 'author', type: 'relationship', relationTo: 'users' },
  ],
  timestamps: true,
}
```

## Auth Collection with RBAC

```typescript
export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  fields: [
    {
      name: 'roles',
      type: 'select',
      hasMany: true,
      options: ['admin', 'editor', 'user'],
      defaultValue: ['user'],
      required: true,
      saveToJWT: true,
      access: {
        update: ({ req: { user } }) => user?.roles?.includes('admin'),
      },
    },
  ],
}
```

Use this leaf when the main decision is collection shape, not draft/version or upload behavior.