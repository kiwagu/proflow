---
title: Adapters - Database and Transactions
description: Use when: configuring Payload database adapters or preserving transaction context across nested operations.
tags: [payload, adapters, transactions, postgres, mongodb, sqlite]
---

# Payload Adapters: Database and Transactions

## Pyramid Layer

- Layer: L3 Payload leaf.

## Use This When

- Load this after the adapters router when the task is about database backends or transaction boundaries.

## Stop Here If

- Stop once the database adapter or transaction model is clear.

## Descend To

- Return to `/.cursor/rules/adapters.md` for storage or email siblings.

## Database Adapters

### MongoDB

```typescript
import { mongooseAdapter } from '@payloadcms/db-mongodb'

export default buildConfig({
  db: mongooseAdapter({
    url: process.env.DATABASE_URL,
  }),
})
```

### Postgres

```typescript
import { postgresAdapter } from '@payloadcms/db-postgres'

export default buildConfig({
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL,
    },
    push: false,
    migrationDir: './migrations',
  }),
})
```

### SQLite

```typescript
import { sqliteAdapter } from '@payloadcms/db-sqlite'

export default buildConfig({
  db: sqliteAdapter({
    client: { url: 'file:./payload.db' },
    transactionOptions: {},
  }),
})
```

## Transaction Rules

Always thread `req` through nested operations in hooks to preserve transaction context.

```typescript
const resaveChildren: CollectionAfterChangeHook = async ({ doc, req }) => {
  const children = await req.payload.find({
    collection: 'children',
    where: { parent: { equals: doc.id } },
    req,
  })

  for (const child of children.docs) {
    await req.payload.update({
      id: child.id,
      collection: 'children',
      data: { updatedField: 'value' },
      req,
    })
  }
}
```

## Manual Transactions

```typescript
const transactionID = await payload.db.beginTransaction()

try {
  await payload.create({
    collection: 'orders',
    data: orderData,
    req: { transactionID },
  })

  await payload.update({
    collection: 'inventory',
    id: itemId,
    data: { stock: newStock },
    req: { transactionID },
  })

  await payload.db.commitTransaction(transactionID)
} catch (error) {
  await payload.db.rollbackTransaction(transactionID)
  throw error
}
```

## Notes

1. MongoDB transactions require replica sets.
2. SQLite transactions are disabled by default.
3. Point fields are not supported in SQLite.