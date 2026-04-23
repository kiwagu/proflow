---
title: Access Control - Factories and Templates
description: Use when: extracting reusable Payload access helpers or composing common collection-level access templates.
tags: [payload, access-control, security, reuse, templates]
priority: high
---

# Advanced Access Control: Factories and Templates

## Pyramid Layer

- Layer: L3 Payload leaf.

## Use This When

- Load this after the advanced-access router when the goal is to remove duplication from access logic or apply a standard access profile to a collection.

## Stop Here If

- Stop once the reusable helper or template shape is chosen.

## Descend To

- Return to `/.cursor/rules/access-control-advanced.md` for sibling context/subscription or performance guidance.

## Factory Functions

Use factories when multiple collections share the same access semantics but differ only in inputs such as roles, team fields, or time windows.

### Role-Based Factory

```typescript
import type { Access } from 'payload'

export function createRoleBasedAccess(roles: string[]): Access {
  return ({ req: { user } }) => {
    if (!user) return false
    return roles.some((role) => user.roles?.includes(role))
  }
}
```

### Organization Scope Factory

```typescript
export function createOrgScopedAccess(allowAdmin = true): Access {
  return ({ req: { user } }) => {
    if (!user) return false
    if (allowAdmin && user.roles?.includes('admin')) return true

    return {
      organizationId: { in: user.organizationIds || [] },
    }
  }
}
```

### Team Scope Factory

```typescript
export function createTeamBasedAccess(teamField = 'teamId'): Access {
  return ({ req: { user } }) => {
    if (!user) return false
    if (user.roles?.includes('admin')) return true

    return {
      [teamField]: { in: user.teamIds || [] },
    }
  }
}
```

### Time-Limited Factory

```typescript
export function createTimeLimitedAccess(daysAccess: number): Access {
  return ({ req: { user } }) => {
    if (!user) return false
    if (user.roles?.includes('admin')) return true

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - daysAccess)

    return {
      createdAt: {
        greater_than_equal: cutoff.toISOString(),
      },
    }
  }
}
```

## Configuration Templates

Templates are useful when a collection follows a recognizable policy shape.

### Public Read, Authenticated Write

```typescript
import type { CollectionConfig } from 'payload'

export const PublicAuthCollection: CollectionConfig = {
  slug: 'posts',
  access: {
    create: ({ req: { user } }) => {
      return user?.roles?.some((role) => ['admin', 'editor'].includes(role)) || false
    },
    read: ({ req: { user } }) => {
      if (user) return true
      return { _status: { equals: 'published' } }
    },
    update: ({ req: { user } }) => {
      return user?.roles?.some((role) => ['admin', 'editor'].includes(role)) || false
    },
    delete: ({ req: { user } }) => user?.roles?.includes('admin') || false,
  },
  versions: {
    drafts: true,
  },
  fields: [],
}
```

### Self-Service Collection

```typescript
export const SelfServiceCollection: CollectionConfig = {
  slug: 'users',
  auth: true,
  access: {
    create: ({ req: { user } }) => user?.roles?.includes('admin') || false,
    read: () => true,
    update: ({ req: { user }, id }) => {
      if (!user) return false
      if (user.roles?.includes('admin')) return true
      return user.id === id
    },
    delete: ({ req: { user } }) => user?.roles?.includes('admin') || false,
  },
  fields: [],
}
```

## Factory Design Rules

1. Keep factories pure and deterministic from their inputs.
2. Prefer returning Payload query constraints over boolean `true` when scoping access to a subset of records.
3. Make admin bypass explicit with a parameter rather than hidden in implementation.
4. Name helpers by policy intent, not by one collection that happens to use them.