# Blob store (`@workspace/blob-store`)

Local-first binary storage for the browser: content-addressed blobs kept in
OPFS (with an IndexedDB fallback), owned by a dedicated worker and reached from
the UI through a small message-port client.

## Role in the architecture

Documents reference media by content hash; this package is the local half of
that contract. It hashes and stores blob bytes, confines paths to the store
root, and runs the media-sync loop that pushes locally-created blobs to a
remote (the remote transport itself is injected — see
`@workspace/blob-sync-supabase` for the Supabase implementation).

- `createBlobWorkerClient` / `openBlobStore` — worker-side store + main-thread client.
- `hashBlob`, `confinePath` — content addressing and path safety.
- `startMediaSyncLoop`, `runPushPass`, `ensureLocal` — reconcile local ↔ remote.

## Commands

```bash
bun run test        # vitest
bun run lint        # eslint (lint:strict for zero warnings)
bun run typecheck   # tsc --noEmit
bun run format      # prettier
```
