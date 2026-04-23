---
title: Fields - Relational and Structured Types
description: Use when: defining Payload relationship, upload, array, blocks, join, tabs, group, or point fields.
tags: [payload, fields, relationship, blocks, upload, layout]
---

# Payload Fields: Relational and Structured Types

## Pyramid Layer

- Layer: L2 Payload leaf.

## Use This When

- Load this after the fields router when the field shape spans other collections, nested structures, media, or layout containers.

## Stop Here If

- Stop once the correct structured field family is identified.

## Descend To

- Return to `/.cursor/rules/fields.md` for simple-type or validation siblings.

## Relationship Fields

```typescript
{
  name: 'author',
  type: 'relationship',
  relationTo: 'users',
  required: true,
  maxDepth: 2,
}

{
  name: 'categories',
  type: 'relationship',
  relationTo: 'categories',
  hasMany: true,
  filterOptions: { active: { equals: true } },
}

{
  name: 'relatedContent',
  type: 'relationship',
  relationTo: ['posts', 'pages'],
  hasMany: true,
}
```

Use `filterOptions` to enforce content constraints in admin UX instead of relying only on editorial discipline.

## Upload Fields

```typescript
{
  name: 'featuredImage',
  type: 'upload',
  relationTo: 'media',
  required: true,
  filterOptions: {
    mimeType: { contains: 'image' },
  },
}
```

## Array and Blocks

```typescript
{
  name: 'slides',
  type: 'array',
  minRows: 2,
  maxRows: 10,
  labels: {
    singular: 'Slide',
    plural: 'Slides',
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'image', type: 'upload', relationTo: 'media' },
  ],
  admin: {
    initCollapsed: true,
  },
}
```

```typescript
import type { Block } from 'payload'

const HeroBlock: Block = {
  slug: 'hero',
  interfaceName: 'HeroBlock',
  fields: [
    { name: 'heading', type: 'text', required: true },
    { name: 'background', type: 'upload', relationTo: 'media' },
  ],
}

{
  name: 'layout',
  type: 'blocks',
  blocks: [HeroBlock],
}
```

Use `array` for repeated homogeneous structures and `blocks` for heterogeneous page-building structures.

## Join Fields and Geospatial Fields

```typescript
{
  name: 'orders',
  type: 'join',
  collection: 'orders',
  on: 'customer',
}

{
  name: 'location',
  type: 'point',
  required: true,
}
```

## Tabs and Groups

```typescript
{
  type: 'tabs',
  tabs: [
    {
      label: 'Content',
      fields: [
        { name: 'title', type: 'text' },
        { name: 'body', type: 'richText' },
      ],
    },
    {
      label: 'SEO',
      fields: [
        { name: 'metaTitle', type: 'text' },
        { name: 'metaDescription', type: 'textarea' },
      ],
    },
  ],
}

{
  name: 'meta',
  type: 'group',
  fields: [
    { name: 'title', type: 'text' },
    { name: 'description', type: 'textarea' },
  ],
}
```

Use `tabs` for author-facing separation of concerns and `group` for logical object-shaped nesting in document schema.