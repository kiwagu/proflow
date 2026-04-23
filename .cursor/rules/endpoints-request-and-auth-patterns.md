---
title: Endpoints - Request and Auth Patterns
description: Use when: creating Payload custom endpoints, reading route params or request bodies, and enforcing auth checks inside handlers.
tags: [payload, endpoints, auth, request]
---

# Payload Endpoints: Request and Auth Patterns

## Pyramid Layer

- Layer: L3 Payload leaf.

## Use This When

- Load this after the endpoints router when the task is about handler logic rather than endpoint placement.

## Stop Here If

- Stop once the request-handling and auth pattern is clear.

## Descend To

- Return to `/.cursor/rules/endpoints.md` for placement or response-shape siblings.

## Basic Authenticated Endpoint

Custom endpoints are not authenticated by default. Check `req.user` explicitly.

```typescript
import { APIError } from 'payload'
import type { Endpoint } from 'payload'

export const protectedEndpoint: Endpoint = {
  path: '/protected',
  method: 'get',
  handler: async (req) => {
    if (!req.user) {
      throw new APIError('Unauthorized', 401)
    }

    const data = await req.payload.find({
      collection: 'posts',
      where: { author: { equals: req.user.id } },
    })

    return Response.json(data)
  },
}
```

## Route Parameters

```typescript
export const trackingEndpoint: Endpoint = {
  path: '/:id/tracking',
  method: 'get',
  handler: async (req) => {
    const { id } = req.routeParams
    const tracking = await getTrackingInfo(id)

    if (!tracking) {
      return Response.json({ error: 'not found' }, { status: 404 })
    }

    return Response.json(tracking)
  },
}
```

## Request Bodies and Query Params

```typescript
import { addDataAndFileToRequest } from 'payload'

export const uploadEndpoint: Endpoint = {
  path: '/upload',
  method: 'post',
  handler: async (req) => {
    // Parse multipart data explicitly when the endpoint expects files.
    await addDataAndFileToRequest(req)

    const result = await req.payload.create({
      collection: 'media',
      data: req.data,
      file: req.file,
    })

    return Response.json(result)
  },
}
```

For JSON requests, `req.data` is not populated automatically. Read the body with `await req.json()`.

```typescript
export const searchEndpoint: Endpoint = {
  path: '/search',
  method: 'get',
  handler: async (req) => {
    const url = new URL(req.url)
    const query = url.searchParams.get('q')
    const limit = parseInt(url.searchParams.get('limit') || '10')

    return req.payload.find({
      collection: 'posts',
      where: { title: { contains: query } },
      limit,
    })
  },
}
```

## Locale and Fallback Locale

Custom endpoints do not receive `req.locale` or `req.fallbackLocale` automatically. If the endpoint needs Payload localization semantics, populate them explicitly.

```typescript
import { addLocalesToRequestFromData } from 'payload'

export const localizedEndpoint: Endpoint = {
  path: '/localized-search',
  method: 'post',
  handler: async (req) => {
    const data = await req.json()
    addLocalesToRequestFromData(req, data)

    return Response.json({
      locale: req.locale,
      fallbackLocale: req.fallbackLocale,
    })
  },
}
```

Use `req.payload` for Local API reads and writes inside handlers so hooks and access behavior stay consistent with the rest of Payload.