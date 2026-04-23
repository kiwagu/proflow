---
title: Access Control - Field, RBAC, and Tenant Patterns
description: Use when: implementing field-level access, defining roles on auth users, or wiring standard multi-tenant Payload access.
tags: [payload, access-control, fields, rbac, multitenancy]
---

# Payload Access Control: Field, RBAC, and Tenant Patterns

## Pyramid Layer

- Layer: L2 Payload leaf.

## Use This When

- Load this after the access-control router when the task is about field booleans, role modeling, or tenant-scoped standard access.

## Stop Here If

- Stop once the needed field/RBAC/tenant pattern is clear.

## Descend To

- Advanced policies: `/.cursor/rules/access-control-advanced.md`
- Return to `/.cursor/rules/access-control.md` for collection-pattern siblings.

## Field Access Rules

Field access only returns booleans, never query constraints.

```typescript
{
  name: 'salary',
  type: 'number',
  access: {
    read: ({ req: { user }, doc }) => {
      if (user?.id === doc?.id) return true
      return user?.roles?.includes('admin')
    },
    update: ({ req: { user } }) => user?.roles?.includes('admin'),
  },
}
```

## RBAC Pattern

Payload does not ship a roles system by default, so model one in the auth collection.

```typescript
export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  fields: [
    {
      name: 'roles',
      type: 'select',
      hasMany: true,
      options: ['admin', 'editor', 'user'],
      defaultValue: ['user'],
      required: true,
      saveToJWT: true,
      access: {
        update: ({ req: { user } }) => user?.roles?.includes('admin'),
      },
    },
  ],
}
```

## Multi-Tenant Pattern

```typescript
interface User {
  id: string
  tenantId: string
  roles?: string[]
}

const tenantAccess: Access = ({ req: { user } }) => {
  if (!user) return false
  if (user.roles?.includes('super-admin')) return true

  return {
    tenant: {
      equals: (user as User).tenantId,
    },
  }
}
```

Use this standard pattern for conventional tenant-scoped CRUD. If the policy becomes time-based, subscription-based, or context-aware, descend into the advanced leaf instead.

## Important Notes

1. Field-level access cannot use query constraints.
2. `admin` access determines whether the collection appears in the admin panel.
3. When passing `user` into the Local API, pair it with `overrideAccess: false` as documented in the queries leaf.