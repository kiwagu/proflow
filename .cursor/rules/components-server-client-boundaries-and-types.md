---
title: Custom Components - Server Client Boundaries and Types
description: Use when: deciding whether a Payload custom component should be server or client, what props it can receive, and how to type it safely.
tags: [payload, components, react, types]
---

# Payload Custom Components: Server Client Boundaries and Types

## Pyramid Layer

- Layer: L4 Payload leaf.

## Use This When

- Load this after the registration-and-boundaries router when the issue is runtime boundary, props, or component typing.

## Stop Here If

- Stop once the runtime boundary and prop contract are clear.

## Descend To

- Return to `/.cursor/rules/components-registration-and-boundaries.md` for path/import-map siblings.

## Server Versus Client

All Payload custom components are server components by default.

```tsx
import type { Payload } from 'payload'

async function PostCount({ payload }: { payload: Payload }) {
  const { totalDocs } = await payload.find({
    collection: 'posts',
    limit: 0,
  })

  return <p>{totalDocs} posts</p>
}
```

```tsx
'use client'

import { useState } from 'react'

export function TogglePreview() {
  const [open, setOpen] = useState(false)
  return <button onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'} preview</button>
}
```

Rules:

1. Client components cannot receive non-serializable props.
2. If a component only reads data, prefer server by default.
3. If a client component needs config or i18n, use Payload hooks.

## Default Props and Config Access

```tsx
async function MyComponent({ payload, locale }) {
  const data = await payload.find({
    collection: 'posts',
    locale,
  })

  return <div>{data.docs.length} posts</div>
}
```

```tsx
'use client'

import { useConfig, useLocale, useTranslation } from '@payloadcms/ui'

export function MyClientComponent() {
  const { config } = useConfig()
  const locale = useLocale()
  const { t } = useTranslation()

  return <div>{t('myNamespace:key')} ({locale}) {config.serverURL}</div>
}
```

## Type Safety

```tsx
import type {
  TextFieldClientComponent,
  TextFieldCellComponent,
  TextFieldServerComponent,
} from 'payload'

export const ServerField: TextFieldServerComponent = ({ field }) => <div>{field.name}</div>
export const ClientField: TextFieldClientComponent = ({ clientField }) => <div>{clientField.name}</div>
export const Cell: TextFieldCellComponent = ({ cellData }) => <span>{cellData}</span>
```

If hooks like `useConfig` are undefined, first verify all `@payloadcms/*` packages are pinned to the exact same version.