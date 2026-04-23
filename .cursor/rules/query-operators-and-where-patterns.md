---
title: Queries - Operators and Where Patterns
description: Use when: building Payload `where` clauses, nested property filters, boolean logic, or query operator expressions.
tags: [payload, queries, where, operators]
---

# Payload Queries: Operators and Where Patterns

## Pyramid Layer

- Layer: L3 Payload leaf.

## Use This When

- Load this after the queries router when the task is about filter syntax rather than transport.

## Stop Here If

- Stop once the needed `where` pattern is found.

## Descend To

- Return to `/.cursor/rules/queries.md` for Local API or transport siblings.

## Query Operators

```typescript
{ color: { equals: 'blue' } }
{ status: { not_equals: 'draft' } }
{ price: { greater_than: 100 } }
{ age: { less_than_equal: 65 } }
{ title: { contains: 'payload' } }
{ description: { like: 'cms headless' } }
{ category: { in: ['tech', 'news'] } }
{ image: { exists: true } }
{ location: { near: [10, 20, 5000] } }
```

## AND and OR Logic

```typescript
{
  or: [
    { color: { equals: 'mint' } },
    {
      and: [
        { color: { equals: 'white' } },
        { featured: { equals: false } },
      ],
    },
  ],
}
```

## Nested Properties

```typescript
{
  'author.role': { equals: 'editor' },
  'meta.featured': { exists: true },
}
```

## Rules

1. Keep `where` clauses declarative and composable.
2. Use nested property filters only when the underlying field shape is stable and intentional.
3. Prefer indexed fields for hot paths.