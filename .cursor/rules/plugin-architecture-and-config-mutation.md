---
title: Plugin Development - Architecture and Config Mutation
description: Use when: creating a Payload plugin skeleton or mutating collections, globals, endpoints, and config through the core plugin transform.
tags: [payload, plugins, architecture, config]
---

# Payload Plugin Development: Architecture and Config Mutation

## Pyramid Layer

- Layer: L3 Payload leaf.

## Use This When

- Load this after the plugin-development router when the task is about the core plugin shape or how a plugin mutates the Payload config.

## Stop Here If

- Stop once the plugin transform pattern is clear.

## Descend To

- Return to `/.cursor/rules/plugin-development.md` for lifecycle or extension-surface siblings.

## Base Architecture

Plugins are curried functions: options in, config transformer out.

```typescript
import type { Config, Plugin } from 'payload'

interface MyPluginConfig {
  enabled?: boolean
  collections?: string[]
}

export const myPlugin =
  (options: MyPluginConfig): Plugin =>
  (config: Config): Config => ({
    ...config,
  })
```

Keep the pattern explicit:

1. First function accepts plugin options.
2. Second function receives Payload config.
3. Return a new config shape instead of scattering mutation without intent.

## Adding Fields to Collections

```typescript
import type { Config, Field, Plugin } from 'payload'

export const seoPlugin =
  (options: { collections?: string[] }): Plugin =>
  (config: Config): Config => {
    const seoFields: Field[] = [
      {
        name: 'meta',
        type: 'group',
        fields: [
          { name: 'title', type: 'text' },
          { name: 'description', type: 'textarea' },
        ],
      },
    ]

    return {
      ...config,
      collections: config.collections?.map((collection) => {
        if (options.collections?.includes(collection.slug)) {
          return {
            ...collection,
            fields: [...(collection.fields || []), ...seoFields],
          }
        }

        return collection
      }),
    }
  }
```

## Adding New Collections

```typescript
import type { CollectionConfig, Config, Plugin } from 'payload'

export const redirectsPlugin =
  (options: { overrides?: Partial<CollectionConfig> }): Plugin =>
  (config: Config): Config => {
    const redirectsCollection: CollectionConfig = {
      slug: 'redirects',
      access: { read: () => true },
      fields: [
        { name: 'from', type: 'text', required: true, unique: true },
        { name: 'to', type: 'text', required: true },
      ],
      ...options.overrides,
    }

    return {
      ...config,
      collections: [...(config.collections || []), redirectsCollection],
    }
  }
```

## Adding Root-Level Endpoints

```typescript
import type { Config, Endpoint, Plugin } from 'payload'

export const seoPlugin =
  (options: { generateTitle?: (doc: any) => string }): Plugin =>
  (config: Config): Config => {
    const generateTitleEndpoint: Endpoint = {
      path: '/plugin-seo/generate-title',
      method: 'post',
      handler: async (req) => {
        const data = await req.json?.()
        const result = options.generateTitle ? options.generateTitle(data.doc) : ''
        return Response.json({ result })
      },
    }

    return {
      ...config,
      endpoints: [...(config.endpoints ?? []), generateTitleEndpoint],
    }
  }
```

## Rules

1. Preserve existing config arrays and objects when adding plugin behavior.
2. Keep plugin mutation scoped to explicit target collections or surfaces.
3. Let user overrides merge last unless the plugin must enforce an invariant.