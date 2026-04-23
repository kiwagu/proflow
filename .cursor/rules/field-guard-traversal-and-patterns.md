---
title: Field Guards - Traversal and Patterns
description: Use when: recursively traversing Payload fields, filtering data-bearing fields, or applying guard combinations in runtime field processing.
tags: [payload, fields, traversal, type-guards]
---

# Payload Field Guards: Traversal and Patterns

## Pyramid Layer

- Layer: L3 Payload leaf.

## Use This When

- Load this after the field-type-guards router when the individual guards are known and the task is now about combining them into traversal or filtering logic.

## Stop Here If

- Stop once the traversal or filtering pattern is clear.

## Descend To

- Return to `/.cursor/rules/field-type-guards.md` for primitive-guard siblings.

## Recursive Traversal

```typescript
import { fieldAffectsData, fieldHasSubFields } from 'payload'

function traverseFields(fields: Field[], callback: (field: Field) => void) {
  fields.forEach((field) => {
    if (fieldAffectsData(field)) {
      callback(field)
    }

    if (fieldHasSubFields(field)) {
      traverseFields(field.fields, callback)
    }
  })
}
```

## Filtering Data-Bearing Fields

```typescript
import { fieldAffectsData, fieldIsHiddenOrDisabled, fieldIsPresentationalOnly } from 'payload'

const dataFields = fields.filter(
  (field) =>
    fieldAffectsData(field) &&
    !fieldIsPresentationalOnly(field) &&
    !fieldIsHiddenOrDisabled(field),
)
```

## Container Switching

```typescript
import { fieldHasSubFields, fieldIsArrayType, fieldIsBlockType } from 'payload'

if (fieldIsArrayType(field)) {
  handleArray(field)
} else if (fieldIsBlockType(field)) {
  handleBlocks(field)
} else if (fieldHasSubFields(field)) {
  handleContainer(field)
}
```

## Safe Property Access

```typescript
import { fieldHasMaxDepth, fieldSupportsMany } from 'payload'

if (fieldSupportsMany(field) && field.hasMany) {
  console.log('Multiple values supported')
}

if (fieldHasMaxDepth(field)) {
  const depth = field.maxDepth
}
```

## Reference Table

Use the underlying guard list in the router file only as an index. Keep actual runtime logic narrow and composed from the few guards the task needs.