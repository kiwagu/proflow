---
title: Custom Components - Admin Hooks and Data Access
description: Use when: using Payload admin hooks, config access, field access, i18n, or runtime data-loading patterns inside custom components.
tags: [payload, components, hooks, i18n, data]
---

# Payload Custom Components: Admin Hooks and Data Access

## Pyramid Layer

- Layer: L4 Payload leaf.

## Use This When

- Load this after the runtime-styling router when the task is about how a component reads admin runtime state or data.

## Stop Here If

- Stop once the hook or data-access pattern is clear.

## Descend To

- Return to `/.cursor/rules/components-runtime-and-styling.md` for styling or troubleshooting siblings.

## Runtime Hooks

```tsx
'use client'

import {
  useAuth,
  useConfig,
  useDocumentInfo,
  useFormFields,
  useLocale,
  usePayload,
  useTranslation,
} from '@payloadcms/ui'
```

Use `useFormFields` instead of `useForm` when you only need a small slice of form state.

Inside the admin UI, import hooks and UI primitives from `@payloadcms/ui` so the admin runtime resolves a single Payload UI package graph.

## Config and Field Access

```tsx
import type { TextFieldServerComponent } from 'payload'

export const ServerField: TextFieldServerComponent = ({ field, payload }) => {
  return <div>{field.name} {payload.config.serverURL}</div>
}
```

Server components receive the full non-serializable Payload config through the `payload` prop.

```tsx
'use client'

import type { TextFieldClientComponent } from 'payload'
import { useConfig } from '@payloadcms/ui'

export const ClientField: TextFieldClientComponent = ({ clientField }) => {
  const {
    config: { serverURL },
  } = useConfig()

  return <div>{clientField.name} {serverURL}</div>
}
```

Client components do not receive the full Payload config. They read the serializable client config through `useConfig()`.

## i18n

```tsx
import { getTranslation } from '@payloadcms/translations'

async function ServerTranslated({ i18n }) {
  return <p>{getTranslation({ en: 'Title' }, i18n)}</p>
}
```

```tsx
'use client'

import { useTranslation } from '@payloadcms/ui'
```

## Runtime Data Patterns

### Conditional Field Visibility

```tsx
'use client'

import { useFormFields } from '@payloadcms/ui'
```

### Loading Data in Client Components

```tsx
'use client'

import { useEffect, useState } from 'react'
```

### Loading Data in Server Components

```tsx
import type { Payload } from 'payload'
```

Prefer server components unless the component truly needs client behavior.

If hooks like `useConfig` or `useTranslation` are undefined, first verify that all `payload` and `@payloadcms/*` packages are pinned to the exact same version and only installed once.