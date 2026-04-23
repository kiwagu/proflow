---
title: Field Guards - Primitives and Capabilities
description: Use when: selecting the correct Payload field type guard for basic data-bearing, container, multiplicity, depth, or virtual-field checks.
tags: [payload, fields, type-guards, narrowing]
---

# Payload Field Guards: Primitives and Capabilities

## Pyramid Layer

- Layer: L3 Payload leaf.

## Use This When

- Load this after the field-type-guards router when the task is about choosing a specific guard or narrowing a field union safely.

## Stop Here If

- Stop once the required guard helper is identified.

## Descend To

- Return to `/.cursor/rules/field-type-guards.md` for traversal and application-pattern siblings.

## Most Common Guards

### `fieldAffectsData`

Use this when you need only fields that actually participate in stored document shape.

```typescript
import { fieldAffectsData } from 'payload'

const dataFields = fields.filter(fieldAffectsData)
```

### `fieldHasSubFields`

Use this when traversing nested field containers.

```typescript
import { fieldHasSubFields } from 'payload'

if (fieldHasSubFields(field)) {
  traverse(field.fields)
}
```

### `fieldIsArrayType`

```typescript
import { fieldIsArrayType } from 'payload'

if (fieldIsArrayType(field)) {
  console.log(field.minRows, field.maxRows)
}
```

## Capability Guards

### `fieldSupportsMany`

```typescript
import { fieldSupportsMany } from 'payload'

if (fieldSupportsMany(field) && field.hasMany) {
  console.log('multiple values supported')
}
```

### `fieldHasMaxDepth`

```typescript
import { fieldHasMaxDepth } from 'payload'

if (fieldHasMaxDepth(field)) {
  const remainingDepth = field.maxDepth - currentDepth
}
```

### `fieldIsVirtual`

```typescript
import { fieldIsVirtual } from 'payload'

if (fieldIsVirtual(field) && typeof field.virtual === 'string') {
  console.log(field.virtual)
}
```

## Type Checking Guards

```typescript
import {
  fieldIsBlockType,
  fieldIsGroupType,
  fieldIsPresentationalOnly,
} from 'payload'

if (fieldIsBlockType(field)) {
  field.blocks.forEach((block) => console.log(block.slug))
}

if (fieldIsGroupType(field)) {
  console.log(field.interfaceName)
}

if (fieldIsPresentationalOnly(field)) {
  return
}
```

## Heuristic

Start with the narrowest semantic question:

1. Does the field store data.
2. Does it contain children.
3. Does it support a specific capability.
4. Is it one concrete field family.