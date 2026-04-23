---
title: Fields - Validation and Dynamic Behavior
description: Use when: adding Payload field validation, conditional admin visibility, virtual fields, or field-level dynamic behavior.
tags: [payload, fields, validation, conditional, virtual]
---

# Payload Fields: Validation and Dynamic Behavior

## Pyramid Layer

- Layer: L2 Payload leaf.

## Use This When

- Load this after the fields router when the field already exists conceptually and the remaining work is about runtime behavior or validation rules.

## Stop Here If

- Stop once the relevant validation or dynamic-behavior pattern is clear.

## Descend To

- Runtime narrowing: `/.cursor/rules/field-type-guards.md`
- Hooks for broader side effects: `/.cursor/rules/hooks.md`
- Return to `/.cursor/rules/fields.md` for type-selection siblings.

## Conditional and Virtual Patterns

```typescript
{
  name: 'featuredImage',
  type: 'upload',
  relationTo: 'media',
  admin: {
    condition: (data) => data.featured === true,
  },
}

{
  name: 'fullName',
  type: 'text',
  virtual: true,
  hooks: {
    afterRead: [({ siblingData }) => `${siblingData.firstName} ${siblingData.lastName}`],
  },
}
```

Use `admin.condition` for presentation logic only. If the value must be enforced at persistence time, add validation or hooks too.

## Validation Pattern

```typescript
{
  name: 'email',
  type: 'email',
  validate: (value, { operation, data, siblingData }) => {
    if (operation === 'create' && !value) {
      return 'Email is required'
    }
    if (value && !value.includes('@')) {
      return 'Invalid email format'
    }
    return true
  },
}
```

Keep validation rules deterministic and local to the field whenever possible.

## Heuristics

1. Use field validation for field-local invariants.
2. Use hooks when validation depends on external state or broader document side effects.
3. Use virtual fields only for derived read models, not as a substitute for stored source-of-truth fields.
4. Avoid burying business logic entirely in `admin.condition`; that only changes editor visibility.