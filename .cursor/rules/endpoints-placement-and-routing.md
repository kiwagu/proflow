---
title: Endpoints - Placement and Routing
description: Use when: deciding whether a Payload custom endpoint belongs on a collection, global, or root config surface.
tags: [payload, endpoints, routing, collections, globals]
---

# Payload Endpoints: Placement and Routing

## Pyramid Layer

- Layer: L3 Payload leaf.

## Use This When

- Load this after the endpoints router when the main question is where the endpoint should live in Payload config.

## Stop Here If

- Stop once the correct mounting surface is clear.

## Descend To

- Return to `/.cursor/rules/endpoints.md` for request-handling or response-shape siblings.

## Collection Endpoints

Mounted at `/api/{collection-slug}/{path}`.

```typescript
export const Orders: CollectionConfig = {
  slug: 'orders',
  endpoints: [
    {
      path: '/:id/tracking',
      method: 'get',
      handler: async (req) => {
        const orderId = req.routeParams.id
        return Response.json({ orderId })
      },
    },
  ],
}
```

Use this when the route is tightly coupled to one collection's document lifecycle.

## Global Endpoints

Mounted at `/api/globals/{global-slug}/{path}`.

```typescript
export const Settings: GlobalConfig = {
  slug: 'settings',
  endpoints: [
    {
      path: '/clear-cache',
      method: 'post',
      handler: async () => {
        await clearCache()
        return Response.json({ message: 'Cache cleared' })
      },
    },
  ],
}
```

Use this when the route belongs to one singleton settings surface.

## Root Endpoints

Mounted at `/api/{path}`.

```typescript
export default buildConfig({
  endpoints: [
    {
      path: '/hello',
      method: 'get',
      handler: () => Response.json({ message: 'Hello!' }),
    },
  ],
})
```

Use root endpoints only when the route is genuinely application-level rather than resource-scoped.

If a top-level endpoint must bypass the configured `routes.api` subpath and mount directly on the Next app root, use `root: true` on that endpoint.

```typescript
export default buildConfig({
  endpoints: [
    {
      path: '/healthz',
      method: 'get',
      root: true,
      handler: () => Response.json({ ok: true }),
    },
  ],
})
```

Only top-level config endpoints can be `root: true`. Collection and global endpoints remain mounted under Payload's API routing.