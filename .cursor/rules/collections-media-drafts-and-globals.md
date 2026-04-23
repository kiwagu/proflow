---
title: Collections - Media, Drafts, and Globals
description: Use when: configuring upload collections, versions and drafts, or Payload globals.
tags: [payload, collections, uploads, drafts, globals]
---

# Payload Collections: Media, Drafts, and Globals

## Pyramid Layer

- Layer: L2 Payload leaf.

## Use This When

- Load this after the collections router when the collection shape is centered on upload behavior, draft/version support, or singleton globals.

## Stop Here If

- Stop once the media/draft/global pattern is clear.

## Descend To

- Return to `/.cursor/rules/collections.md` for basic collection or auth siblings.

## Upload Collection

```typescript
export const Media: CollectionConfig = {
  slug: 'media',
  upload: {
    staticDir: 'media',
    mimeTypes: ['image/*'],
    imageSizes: [
      {
        name: 'thumbnail',
        width: 400,
        height: 300,
        position: 'centre',
      },
      {
        name: 'card',
        width: 768,
        height: 1024,
      },
    ],
    adminThumbnail: 'thumbnail',
    focalPoint: true,
    crop: true,
  },
  access: {
    read: () => true,
  },
  fields: [{ name: 'alt', type: 'text', required: true }],
}
```

## Versioning and Drafts

```typescript
export const Pages: CollectionConfig = {
  slug: 'pages',
  versions: {
    drafts: {
      autosave: true,
      schedulePublish: true,
      validate: false,
      maxPerDoc: 100,
    },
  },
  access: {
    read: ({ req: { user } }) => {
      if (!user) return { _status: { equals: 'published' } }
      return true
    },
  },
}
```

```typescript
await payload.create({
  collection: 'posts',
  data: { title: 'Draft Post' },
  draft: true,
})
```

## Globals

```typescript
import type { GlobalConfig } from 'payload'

export const Header: GlobalConfig = {
  slug: 'header',
  label: 'Header',
  admin: {
    group: 'Settings',
  },
  fields: [
    {
      name: 'logo',
      type: 'upload',
      relationTo: 'media',
      required: true,
    },
    {
      name: 'nav',
      type: 'array',
      maxRows: 8,
      fields: [
        { name: 'link', type: 'relationship', relationTo: 'pages' },
        { name: 'label', type: 'text' },
      ],
    },
  ],
}
```

Use this leaf when the main complexity is media processing, draft workflow, or singleton configuration documents.