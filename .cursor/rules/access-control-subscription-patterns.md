---
title: Access Control - Subscription Patterns
description: Use when: implementing active-subscription or tier-based Payload access checks.
tags: [payload, access-control, subscriptions]
priority: high
---

# Advanced Access Control: Subscription Patterns

## Pyramid Layer

- Layer: L4 Payload leaf.

## Use This When

- Load this after the context-and-subscription router when the policy depends on subscription records or subscription tiers.

## Stop Here If

- Stop once the subscription policy shape is clear.

## Descend To

- Return to `/.cursor/rules/access-control-context-and-subscription-patterns.md` for context/time siblings.

## Active Subscription Required

```typescript
export const activeSubscriptionAccess: Access = async ({ req: { user } }) => {
  if (!user) return false
  if (user.roles?.includes('admin')) return true

  try {
    const subscription = await req.payload.findByID({
      collection: 'subscriptions',
      id: user.subscriptionId,
    })

    return subscription?.status === 'active'
  } catch {
    return false
  }
}
```

## Tier-Based Access

```typescript
export const tierBasedAccess = (requiredTier: string): Access => {
  const tierHierarchy = ['free', 'basic', 'pro', 'enterprise']

  return async ({ req: { user } }) => {
    if (!user) return false
    if (user.roles?.includes('admin')) return true

    try {
      const subscription = await req.payload.findByID({
        collection: 'subscriptions',
        id: user.subscriptionId,
      })

      if (subscription?.status !== 'active') return false
      return tierHierarchy.indexOf(subscription.tier) >= tierHierarchy.indexOf(requiredTier)
    } catch {
      return false
    }
  }
}
```

## Heuristics

1. Use async subscription checks only when state lives in another collection or service.
2. Keep an explicit admin bypass decision.
3. Return `false` on lookup failure for deny-by-default behavior.