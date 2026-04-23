---
title: Fields - Editorial and Simple Types
description: Use when: defining common Payload text, rich text, or select fields and the surrounding editorial field shape.
tags: [payload, fields, text, richtext, select]
---

# Payload Fields: Editorial and Simple Types

## Pyramid Layer

- Layer: L2 Payload leaf.

## Use This When

- Load this after the fields router when the task is about basic editorial field types and common field options.

## Stop Here If

- Stop once the correct field type and option set are clear.

## Descend To

- Return to `/.cursor/rules/fields.md` for relationship, layout, or validation siblings.

## Common Editorial Patterns

```typescript
import { slugField } from 'payload'

slugField({ fieldToUse: 'title' })

{
  name: 'fullName',
  type: 'text',
  virtual: true,
  hooks: {
    afterRead: [({ siblingData }) => `${siblingData.firstName} ${siblingData.lastName}`],
  },
}
```

Use these defaults before adding complexity:

1. Prefer indexed text fields only when they truly participate in lookup or uniqueness constraints.
2. Localize editorial fields only when the content itself varies by locale.
3. Keep `admin.condition` small and deterministic.

## Text Fields

```typescript
{
  name: 'title',
  type: 'text',
  required: true,
  unique: true,
  minLength: 5,
  maxLength: 100,
  index: true,
  localized: true,
  defaultValue: 'Default Title',
  validate: (value) => Boolean(value) || 'Required',
  admin: {
    placeholder: 'Enter title...',
    position: 'sidebar',
    condition: (data) => data.showTitle === true,
  },
}
```

## Rich Text

Lexical is the current editor path in Payload 3.x. The legacy Slate editor is deprecated and scheduled for removal in Payload 4.

```typescript
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { HeadingFeature, LinkFeature } from '@payloadcms/richtext-lexical'

{
  name: 'content',
  type: 'richText',
  required: true,
  editor: lexicalEditor({
    features: ({ defaultFeatures, rootFeatures }) => [
      ...rootFeatures,
      HeadingFeature({ enabledHeadingSizes: ['h1', 'h2', 'h3'] }),
      LinkFeature({ enabledCollections: ['posts', 'pages'] }),
    ],
  }),
}
```

Use `defaultFeatures` when defining the root editor in `payload.config.ts`. Use `rootFeatures` in field-level overrides when you want to start from the root editor's allowed feature set and then add or prune field-specific behavior.

If the project has not defined a root Lexical editor in `payload.config.ts`, `rootFeatures` may be empty. In that case, start from `defaultFeatures` instead.

Prefer constraining editor features to the real authoring surface instead of exposing every default capability blindly.

## Select Fields

```typescript
{
  name: 'status',
  type: 'select',
  options: [
    { label: 'Draft', value: 'draft' },
    { label: 'Published', value: 'published' },
  ],
  defaultValue: 'draft',
  required: true,
}

{
  name: 'tags',
  type: 'select',
  hasMany: true,
  options: ['tech', 'news', 'sports'],
}
```

Use `select` when the option set is bounded and stable. If the option source is another collection, switch to `relationship` instead.