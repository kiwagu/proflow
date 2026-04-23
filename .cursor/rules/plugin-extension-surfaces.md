---
title: Plugin Development - Extension Surfaces
description: Use when: extending Payload plugins with hooks, admin components, or user-configurable field overrides.
tags: [payload, plugins, hooks, admin-ui, fields]
---

# Payload Plugin Development: Extension Surfaces

## Pyramid Layer

- Layer: L3 Payload leaf.

## Use This When

- Load this after the plugin-development router when the plugin already exists and the task is about which Payload surface to extend.

## Stop Here If

- Stop once the correct extension surface is chosen.

## Descend To

- Return to `/.cursor/rules/plugin-development.md` for architecture or lifecycle siblings.

## Adding Hooks

```typescript
import type { CollectionAfterChangeHook, Config, Plugin } from 'payload'

const resaveChildrenHook: CollectionAfterChangeHook = async ({ doc, req, operation }) => {
  if (operation === 'update') {
    const children = await req.payload.find({
      collection: 'pages',
      where: { parent: { equals: doc.id } },
    })

    for (const child of children.docs) {
      await req.payload.update({
        collection: 'pages',
        id: child.id,
        data: child,
      })
    }
  }

  return doc
}

export const nestedDocsPlugin =
  (options: { collections: string[] }): Plugin =>
  (config: Config): Config => ({
    ...config,
    collections: (config.collections || []).map((collection) => {
      if (options.collections.includes(collection.slug)) {
        return {
          ...collection,
          hooks: {
            ...(collection.hooks || {}),
            afterChange: [resaveChildrenHook, ...(collection.hooks?.afterChange || [])],
          },
        }
      }

      return collection
    }),
  })
```

## Field Overrides with Defaults

```typescript
import type { Config, Field, Plugin } from 'payload'

type FieldsOverride = (args: { defaultFields: Field[] }) => Field[]

interface PluginConfig {
  collections?: string[]
  fields?: FieldsOverride
}

export const myPlugin =
  (options: PluginConfig): Plugin =>
  (config: Config): Config => {
    const defaultFields: Field[] = [
      { name: 'title', type: 'text' },
      { name: 'description', type: 'textarea' },
    ]

    const fields =
      options.fields && typeof options.fields === 'function'
        ? options.fields({ defaultFields })
        : defaultFields

    return {
      ...config,
      collections: config.collections?.map((collection) => {
        if (options.collections?.includes(collection.slug)) {
          return {
            ...collection,
            fields: [...(collection.fields || []), ...fields],
          }
        }

        return collection
      }),
    }
  }
```

## Admin Components

```typescript
export const myPlugin =
  (options: PluginConfig): Plugin =>
  (config: Config): Config => {
    if (!config.admin) config.admin = {}
    if (!config.admin.components) config.admin.components = {}
    if (!config.admin.components.beforeDashboard) {
      config.admin.components.beforeDashboard = []
    }

    config.admin.components.beforeDashboard.push('my-plugin-name/client#BeforeDashboardClient')
    config.admin.components.beforeDashboard.push('my-plugin-name/rsc#BeforeDashboardServer')

    return config
  }
```

## Surface Selection Heuristic

1. Use hooks for runtime behavior on document operations.
2. Use field overrides when the plugin needs configurable schema injection.
3. Use admin components only when the plugin must affect author UX directly.