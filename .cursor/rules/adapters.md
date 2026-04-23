---
title: Database Adapters & Transactions
description: Use when: working on Payload adapters, storage integrations, email integration, or transaction patterns.
tags: [payload, database, mongodb, postgres, sqlite, transactions]
---

# Payload CMS Adapters

## Pyramid Layer

- Layer: L2 Payload router.

## Use This When

- Load this after the Payload router when the task is specifically about database adapters, storage backends, or transaction boundaries.
- Use this file to choose the narrowest adapter leaf before loading examples.

## Stop Here If

- Stop here once the task is clearly about database/transactions or storage/email integrations.

## Descend To

- Database adapters and transaction boundaries: `/.cursor/rules/adapters-database-and-transactions.md`
- Storage and email adapters: `/.cursor/rules/adapters-storage-and-email.md`
- Return to `/.cursor/rules/payload-overview.md` if the task expands into sibling Payload concerns.

Adapter work now splits into two narrow concerns:

1. Database backends and transaction boundaries.
2. Storage and email delivery adapters.

Load only the matching leaf above.
