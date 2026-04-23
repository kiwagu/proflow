---
title: Adapters - Storage and Email
description: Use when: configuring Payload storage adapters, file backends, or email delivery adapters.
tags: [payload, adapters, storage, email, s3, smtp]
---

# Payload Adapters: Storage and Email

## Pyramid Layer

- Layer: L3 Payload leaf.

## Use This When

- Load this after the adapters router when the task is about uploads or email delivery integrations.

## Stop Here If

- Stop once the correct storage or email adapter is chosen.

## Descend To

- Return to `/.cursor/rules/adapters.md` for database and transaction siblings.

## Storage Adapters

Available storage adapters include S3, Azure Blob, GCS, R2, Vercel Blob, and Uploadthing.

### AWS S3

```typescript
import { s3Storage } from '@payloadcms/storage-s3'

export default buildConfig({
  plugins: [
    s3Storage({
      collections: {
        media: true,
      },
      bucket: process.env.S3_BUCKET,
      config: {
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        },
        region: process.env.S3_REGION,
      },
    }),
  ],
})
```

## Email Adapters

### Nodemailer

```typescript
import { nodemailerAdapter } from '@payloadcms/email-nodemailer'

export default buildConfig({
  email: nodemailerAdapter({
    defaultFromAddress: 'noreply@example.com',
    defaultFromName: 'My App',
    transportOptions: {
      host: process.env.SMTP_HOST,
      port: 587,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    },
  }),
})
```

### Resend

```typescript
import { resendAdapter } from '@payloadcms/email-resend'

export default buildConfig({
  email: resendAdapter({
    defaultFromAddress: 'noreply@example.com',
    defaultFromName: 'My App',
    apiKey: process.env.RESEND_API_KEY,
  }),
})
```

In this repository, outbound email policy still belongs to the central notifications rule when the feature goes beyond a raw adapter choice.