---
title: Access Control - Context and Time Patterns
description: Use when: implementing locale-aware, device-aware, IP-based, or date-window Payload access constraints.
tags: [payload, access-control, context, time]
priority: high
---

# Advanced Access Control: Context and Time Patterns

## Pyramid Layer

- Layer: L4 Payload leaf.

## Use This When

- Load this after the context-and-subscription router when the policy depends on request context or time windows, not paid subscription state.

## Stop Here If

- Stop once the context or date-window pattern is clear.

## Descend To

- Return to `/.cursor/rules/access-control-context-and-subscription-patterns.md` for subscription siblings.

## Context-Aware Patterns

### Locale-Specific Access

```typescript
import type { Access } from 'payload'

export const localeSpecificAccess: Access = ({ req: { user, locale } }) => {
  if (user) return true
  return locale === 'en'
}
```

### Device-Specific Access

```typescript
export const mobileOnlyAccess: Access = ({ req: { headers } }) => {
  const userAgent = headers?.get('user-agent') || ''
  return /mobile|android|iphone/i.test(userAgent)
}
```

### IP-Based Access

```typescript
export const restrictedIpAccess = (allowedIps: string[]): Access => {
  return ({ req: { headers } }) => {
    const ip = headers?.get('x-forwarded-for') || headers?.get('x-real-ip')
    return allowedIps.includes(ip || '')
  }
}
```

## Time-Based Patterns

### Today Only

```typescript
export const todayOnlyAccess: Access = ({ req: { user } }) => {
  if (!user) return false
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000)

  return {
    createdAt: {
      greater_than_equal: startOfDay.toISOString(),
      less_than: endOfDay.toISOString(),
    },
  }
}
```

### Last N Days and Publish Window

Use query constraints for date windows and publish visibility whenever possible.