---
title: Payload CMS Overview
description: Use when: starting any Payload CMS task and choosing the narrowest Payload rule to load.
tags: [payload, overview, quickstart]
---

# Payload CMS Development Rules

## Pyramid Layer

- Layer: L0 Payload router.

## Use This When

- Start here for any Payload collection, field, hook, endpoint, query, plugin, or admin UI work.
- Use this file to choose the narrowest Payload leaf doc before loading examples.

## Stop Here If

- Stop here if the core principles below already cover the decision.
- Otherwise descend only into the minimum sibling docs needed for the task.

## Descend To

- Schema shape: `/.cursor/rules/collections.md`, `/.cursor/rules/fields.md`, `/.cursor/rules/field-type-guards.md`
- Access and security: `/.cursor/rules/access-control.md`, `/.cursor/rules/access-control-advanced.md`, `/.cursor/rules/security-critical.mdc`
- Runtime behavior: `/.cursor/rules/hooks.md`, `/.cursor/rules/endpoints.md`, `/.cursor/rules/queries.md`
- Admin UI and extensibility: `/.cursor/rules/components.md`, `/.cursor/rules/plugin-development.md`
- Infrastructure and persistence: `/.cursor/rules/adapters.md`

You are an expert Payload CMS developer. When working with Payload projects, follow these rules:

## Core Principles

1. **TypeScript-First**: Always use TypeScript with proper types from Payload
2. **Security-Critical**: Follow all security patterns, especially access control
3. **Type Generation**: Run `generate:types` script after schema changes
4. **Transaction Safety**: Always pass `req` to nested operations in hooks
5. **Access Control**: Understand Local API bypasses access control by default
6. **Version-Anchor Payload Guidance**: Keep rules aligned with the installed `payload` and `@payloadcms/*` runtime version in `apps/author/package.json`, not whichever upstream doc is newest.
7. **Keep Next Integration Official**: In Next-based Payload apps, keep `next.config` wrapped with `withPayload` from `@payloadcms/next/withPayload`.

## Version Anchor For This Repo

- Installed runtime authority: `apps/author/package.json`
- Current pinned runtime: `payload` `3.83.0` and matching `@payloadcms/*` packages
- When syncing upstream docs, prefer the installed runtime version as the source of truth and record any upstream mismatch before updating rules.
- Compatible Next floor for this runtime family: `16.2.2+`

## Next.js Integration Notes

- For Next-based Payload apps, keep the app config wrapped with `withPayload` so Payload stays compatible with packages like `mongodb` and its admin/runtime integration.
- With Next `16.2+`, Payload docs warn that server fast refresh can miss admin/config changes during dev. If config or import-map changes do not propagate, restart the dev server before assuming the rule or code is wrong.

## Project Structure

```
src/
├── app/
│   ├── (frontend)/          # Frontend routes
│   └── (payload)/           # Payload admin routes
├── collections/             # Collection configs
├── globals/                 # Global configs
├── components/              # Custom React components
├── hooks/                   # Hook functions
├── access/                  # Access control functions
└── payload.config.ts        # Main config
```

## Minimal Config Pattern

```typescript
import { buildConfig } from 'payload'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { fileURLToPath } from 'url'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: 'users',
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Users, Media],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: mongooseAdapter({
    url: process.env.DATABASE_URL,
  }),
})
```

## Getting Payload Instance

```typescript
// In API routes (Next.js)
import { getPayload } from 'payload'
import config from '@payload-config'

export async function GET() {
  const payload = await getPayload({ config })

  const posts = await payload.find({
    collection: 'posts',
  })

  return Response.json(posts)
}

// In Server Components
import { getPayload } from 'payload'
import config from '@payload-config'

export default async function Page() {
  const payload = await getPayload({ config })
  const { docs } = await payload.find({ collection: 'posts' })

  return <div>{docs.map(post => <h1 key={post.id}>{post.title}</h1>)}</div>
}
```

## Quick Reference

| Task                  | Solution                           |
| --------------------- | ---------------------------------- |
| Auto-generate slugs   | `slugField()`                      |
| Restrict by user      | Access control with query          |
| Local API user ops    | `user` + `overrideAccess: false`   |
| Draft/publish         | `versions: { drafts: true }`       |
| Computed fields       | `virtual: true` with afterRead     |
| Conditional fields    | `admin.condition`                  |
| Custom validation     | `validate` function                |
| Filter relationships  | `filterOptions` on field           |
| Select fields         | `select` parameter                 |
| Auto-set dates        | beforeChange hook                  |
| Prevent loops         | `req.context` check                |
| Cascading deletes     | beforeDelete hook                  |
| Geospatial queries    | `point` field with `near`/`within` |
| Reverse relationships | `join` field type                  |
| Query relationships   | Nested property syntax             |
| Complex queries       | AND/OR logic                       |
| Transactions          | Pass `req` to operations           |
| Background jobs       | Jobs queue with tasks              |
| Custom routes         | Collection custom endpoints        |
| Cloud storage         | Storage adapter plugins            |
| Multi-language        | `localization` + `localized: true` |

## Resources

- Docs: https://payloadcms.com/docs
- LLM Context: https://payloadcms.com/llms-full.txt
- GitHub: https://github.com/payloadcms/payload
- Examples: https://github.com/payloadcms/payload/tree/main/examples
- Templates: https://github.com/payloadcms/payload/tree/main/templates
