---
title: Plugin Development - Lifecycle and Safety
description: Use when: handling plugin disable behavior, onInit logic, or the safety rules that preserve user config and hook composition.
tags: [payload, plugins, lifecycle, oninit, safety]
---

# Payload Plugin Development: Lifecycle and Safety

## Pyramid Layer

- Layer: L3 Payload leaf.

## Use This When

- Load this after the plugin-development router when the task is about plugin lifecycle toggles, initialization, or safe composition.

## Stop Here If

- Stop once the lifecycle behavior and safety constraints are clear.

## Descend To

- Return to `/.cursor/rules/plugin-development.md` for architecture or extension-surface siblings.

## Disable Plugin Pattern

```typescript
interface PluginConfig {
  disabled?: boolean
  collections?: string[]
}

export const myPlugin =
  (options: PluginConfig): Plugin =>
  (config: Config): Config => {
    if (!config.collections) {
      config.collections = []
    }

    config.collections.push({
      slug: 'plugin-collection',
      fields: [{ name: 'title', type: 'text' }],
    })

    if (options.disabled) {
      return config
    }

    config.endpoints = [
      ...(config.endpoints ?? []),
      {
        path: '/my-endpoint',
        method: 'get',
        handler: async () => Response.json({ message: 'Hello' }),
      },
    ]

    return config
  }
```

If a plugin owns schema, keep schema additions deterministic even when feature behavior is disabled.

## onInit Hook

```typescript
export const myPlugin =
  (options: PluginConfig): Plugin =>
  (config: Config): Config => {
    const incomingOnInit = config.onInit

    config.onInit = async (payload) => {
      if (incomingOnInit) await incomingOnInit(payload)

      payload.logger.info('Plugin initialized')

      const { totalDocs } = await payload.count({
        collection: 'plugin-collection',
        where: { id: { equals: 'seeded-by-plugin' } },
      })

      if (totalDocs === 0) {
        await payload.create({
          collection: 'plugin-collection',
          data: { id: 'seeded-by-plugin' },
        })
      }
    }

    return config
  }
```

Always preserve and call the incoming `onInit` before plugin-specific initialization.

## Safety Rules

### Preserve Existing Config

```typescript
collections: [...(config.collections || []), newCollection]
```

### Respect User Overrides

```typescript
const collection: CollectionConfig = {
  slug: 'redirects',
  fields: defaultFields,
  ...options.overrides,
}
```

### Hook Composition

```typescript
hooks: {
  ...collection.hooks,
  afterChange: [myHook, ...(collection.hooks?.afterChange || [])],
}
```

### Type Safety

```typescript
import type { CollectionConfig, Config, Field, Plugin } from 'payload'
```

These are not style preferences. They keep plugins composable instead of destructive.