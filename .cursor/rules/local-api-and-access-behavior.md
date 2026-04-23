---
title: Queries - Local API and Access Behavior
description: Use when: querying Payload through the Local API, performing operations on behalf of a user, or deciding whether `overrideAccess` must be false.
tags: [payload, queries, local-api, access-control]
---

# Payload Queries: Local API and Access Behavior

## Pyramid Layer

- Layer: L3 Payload leaf.

## Use This When

- Load this after the queries router when the task uses `payload.find`, `findByID`, `create`, `update`, `delete`, or `count` directly in server code.

## Stop Here If

- Stop once the Local API pattern and access mode are clear.

## Descend To

- Return to `/.cursor/rules/queries.md` for operator or transport siblings.

## Local API Examples

```typescript
const posts = await payload.find({
  collection: 'posts',
  where: {
    status: { equals: 'published' },
    'author.name': { contains: 'john' },
  },
  depth: 2,
  limit: 10,
  page: 1,
  sort: '-createdAt',
  locale: 'en',
  select: {
    title: true,
    author: true,
  },
})

const post = await payload.findByID({
  collection: 'posts',
  id: '123',
  depth: 2,
})

await payload.update({
  collection: 'posts',
  id: '123',
  data: { status: 'published' },
})
```

## Access Control in Local API

Local API bypasses access control by default.

```typescript
const posts = await payload.find({
  collection: 'posts',
  user: currentUser,
  overrideAccess: false,
})
```

Use `overrideAccess: false` when:

1. Acting on behalf of a real user.
2. Testing access control.
3. Building routes that must respect user permissions.

If you omit it, the operation runs with admin-like bypass semantics.

## Important Defaults

Payload Local API defaults that matter in rule design:

1. `overrideAccess` defaults to `true`.
2. `overrideLock` defaults to `true`.
3. `pagination` defaults to `true`.
4. `context` is forwarded into hook `context` and `req.context`.

```typescript
const posts = await payload.find({
  collection: 'posts',
  overrideAccess: false,
  overrideLock: false,
  user: currentUser,
  pagination: false,
  context: {
    triggerAfterChange: false,
  },
})
```

Set `overrideLock: false` when document locks should actually be enforced. Set `pagination: false` when you intentionally want all matching docs and want to skip count queries.