---
title: Queries - REST, GraphQL, and Performance
description: Use when: translating Payload queries into REST or GraphQL requests, or tightening query performance and selection depth.
tags: [payload, queries, rest, graphql, performance]
---

# Payload Queries: REST, GraphQL, and Performance

## Pyramid Layer

- Layer: L3 Payload leaf.

## Use This When

- Load this after the queries router when the transport matters or when the query shape is correct but too expensive.

## Stop Here If

- Stop once the external transport or performance pattern is clear.

## Descend To

- Return to `/.cursor/rules/queries.md` for Local API or operator siblings.

## REST API Pattern

```typescript
import { stringify } from 'qs-esm'

const query = {
  status: { equals: 'published' },
}

const queryString = stringify(
  {
    where: query,
    depth: 2,
    limit: 10,
  },
  { addQueryPrefix: true },
)

const response = await fetch(`https://api.example.com/api/posts${queryString}`)
const data = await response.json()
```

REST endpoints:

```text
GET    /api/{collection}
GET    /api/{collection}/{id}
POST   /api/{collection}
PATCH  /api/{collection}/{id}
DELETE /api/{collection}/{id}
GET    /api/{collection}/count
GET    /api/globals/{slug}
POST   /api/globals/{slug}
```

## GraphQL Pattern

```graphql
query {
  Posts(where: { status: { equals: published } }, limit: 10, sort: "-createdAt") {
    docs {
      id
      title
      author {
        name
      }
    }
    totalDocs
    hasNextPage
  }
}

mutation {
  createPost(data: { title: "New Post", status: draft }) {
    id
    title
  }
}
```

## Performance Rules

1. Set explicit depth and avoid over-fetching relationships.
2. Use `select` to limit returned fields.
3. Use `populate` only when you need precise nested field control beyond `depth`.
4. Turn `pagination` off when you need all docs and want to avoid count queries.
5. Index fields that are queried frequently.
6. Use virtual fields only for intentional computed read models.
7. Cache expensive derived work in hook context when the query path triggers hooks.