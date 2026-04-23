---
title: Endpoints - Errors, CORS, and Responses
description: Use when: shaping Payload endpoint responses, adding CORS headers, or handling validation and error cases consistently.
tags: [payload, endpoints, cors, errors, responses]
---

# Payload Endpoints: Errors, CORS, and Responses

## Pyramid Layer

- Layer: L3 Payload leaf.

## Use This When

- Load this after the endpoints router when the endpoint exists but the response and failure contract still need to be shaped.

## Stop Here If

- Stop once the response and error pattern are clear.

## Descend To

- Return to `/.cursor/rules/endpoints.md` for request-handling or placement siblings.

## CORS Headers

```typescript
import { headersWithCors } from 'payload'

export const corsEndpoint: Endpoint = {
  path: '/public-data',
  method: 'get',
  handler: async (req) => {
    const data = await fetchPublicData()

    return Response.json(data, {
      headers: headersWithCors({
        headers: new Headers(),
        req,
      }),
    })
  },
}
```

## Error Handling

```typescript
import { APIError } from 'payload'

export const validateEndpoint: Endpoint = {
  path: '/validate',
  method: 'post',
  handler: async (req) => {
    const data = await req.json()

    if (!data.email) {
      throw new APIError('Email is required', 400)
    }

    return Response.json({ valid: true })
  },
}
```

## Response Rules

1. Return Web `Response` objects, preferably with `Response.json()`.
2. Throw `APIError` for predictable request failures.
3. Validate input explicitly.
4. Use `req.payload.logger` for endpoint debugging rather than silent failure.