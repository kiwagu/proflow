---
title: Custom Components - Field Slots and Props
description: Use when: overriding field edit or cell components, using UI-only fields, or deciding how custom props flow into Payload admin components.
tags: [payload, components, fields, props]
---

# Payload Custom Components: Field Slots and Props

## Pyramid Layer

- Layer: L4 Payload leaf.

## Use This When

- Load this after the slots-and-overrides router when the task is about field rendering or custom component props.

## Stop Here If

- Stop once the field slot or prop contract is clear.

## Descend To

- Return to `/.cursor/rules/components-slots-and-overrides.md` for root/resource slot siblings.

## Field Components

### Edit Surface

```typescript
{
  name: 'status',
  type: 'select',
  options: ['draft', 'published'],
  admin: {
    components: {
      Field: '/components/StatusField',
    },
  },
}
```

```tsx
'use client'

import { useField } from '@payloadcms/ui'
import type { SelectFieldClientComponent } from 'payload'

export const StatusField: SelectFieldClientComponent = ({ path, field }) => {
  const { value, setValue } = useField({ path })

  return (
    <select value={value} onChange={(event) => setValue(event.target.value)}>
      {field.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
```

### List Cell Surface

```typescript
{
  name: 'status',
  type: 'select',
  options: ['draft', 'published'],
  admin: {
    components: {
      Cell: '/components/StatusCell',
    },
  },
}
```

### UI-Only Fields

```typescript
{
  name: 'refundButton',
  type: 'ui',
  admin: {
    components: {
      Field: '/components/RefundButton',
    },
  },
}
```

## Default and Custom Props

```typescript
{
  logout: {
    Button: {
      path: '/components/Logout',
      clientProps: {
        buttonText: 'Sign Out',
      },
    },
  },
}
```

Rules:

1. `clientProps` must stay serializable.
2. Prefer server props for data access, not callbacks.
3. Keep custom props narrow and task-specific.

## Slot Selection Heuristic

1. Field slot if the change belongs to one field.
2. Collection or global slot if it belongs to one resource screen.
3. Root slot only if it truly affects the whole admin shell.