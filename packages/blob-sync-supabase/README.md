# Blob sync — Supabase remote (`@workspace/blob-sync-supabase`)

The Supabase Storage implementation of the blob-sync remote contract used by
`@workspace/blob-store`. It maps content hashes to bucket object keys and
performs the actual upload/download against the workbench blob bucket.

## Role in the architecture

Driven adapter: `@workspace/blob-store` defines what a remote must do (push a
blob, fetch a blob); this package supplies the Supabase-backed version
(`createSupabaseBlobSyncRemote`, `blobObjectKey`, `WORKBENCH_BLOB_BUCKET`).
Keeping it separate means the store and its sync loop stay testable without a
Supabase client, and the remote can be swapped per host.

## Commands

```bash
bun run test        # vitest
bun run lint        # eslint (lint:strict for zero warnings)
bun run typecheck   # tsc --noEmit
bun run format      # prettier
```
