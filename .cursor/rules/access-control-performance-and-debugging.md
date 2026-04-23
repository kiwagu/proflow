---
title: Access Control - Performance and Debugging
description: Use when: optimizing Payload access checks, avoiding hot-path async work, or debugging access behavior and missing arguments.
tags: [payload, access-control, performance, debugging, security]
priority: high
---

# Advanced Access Control: Performance and Debugging

## Pyramid Layer

- Layer: L3 Payload leaf.

## Use This When

- Load this after the advanced-access router when access code is correct in principle but is too slow, too noisy, or hard to debug.

## Stop Here If

- Stop once the hot-path fix or debugging method is clear.

## Descend To

- Return to `/.cursor/rules/access-control-advanced.md` for sibling policy-pattern guidance.

## Performance Rules

### Avoid Async Work in Hot Paths

```typescript
// Slow: multiple sequential lookups during access evaluation.
export const slowAccess: Access = async ({ req: { user } }) => {
  const org = await req.payload.findByID({ collection: 'orgs', id: user.orgId })
  const team = await req.payload.findByID({ collection: 'teams', id: user.teamId })
  const subscription = await req.payload.findByID({ collection: 'subs', id: user.subId })

  return org.active && team.active && subscription.active
}
```

Prefer cached context or indexed constraints.

```typescript
export const fastAccess: Access = ({ req: { user, context } }) => {
  if (context.orgStatus === undefined) {
    context.orgStatus = checkOrgStatus(user.orgId)
  }

  return context.orgStatus
}
```

### Prefer Indexed Query Constraints

```typescript
export const fastQuery: Access = () => ({
  status: { equals: 'active' },
  organizationId: { in: ['org1', 'org2'] },
})
```

Avoid non-indexed deep metadata predicates in high-volume collections.

### Be Careful with Array Field Access

Array-field access runs often. Cache repeated decisions in `req.context` instead of re-running expensive checks for each item.

### Avoid N+1 Patterns

If access runs on list views, per-document `findByID` calls become multiplicative. Prefer database-level constraints.

## Debugging Techniques

### Log the Evaluation Shape

```typescript
export const debugAccess: Access = ({ req: { user }, id }) => {
  console.log('Access check', {
    userId: user?.id,
    roles: user?.roles,
    docId: id,
  })

  return true
}
```

### Check Available Arguments

```typescript
export const checkArgsAccess: Access = (args) => {
  console.log({
    hasReq: 'req' in args,
    hasUser: Boolean(args.req?.user),
    hasId: Boolean(args.id),
    hasData: Boolean(args.data),
  })

  return true
}
```

### Test Public Access Explicitly

```typescript
const result = await payload.find({
  collection: 'posts',
  overrideAccess: false,
  user: undefined,
})
```

## Best Practices

1. Default deny.
2. Return `false` on unexpected errors.
3. Use `req.context` for expensive shared decisions.
4. Test no-user, wrong-user, and admin-user paths.
5. Keep comments for intent, not for obvious mechanics.