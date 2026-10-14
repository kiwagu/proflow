export { fromByteaHex, toByteaHex } from './bytea.js';
export { DocumentNotRegisteredError } from './errors.js';
export {
  createDocumentSync,
  type DocumentRefusal,
  type DocumentSync,
  type DocumentSyncOptions,
  type SpacePassOutcome,
  type SpaceWatch,
  type SpaceWatchHooks,
} from './document-sync.js';
export {
  createPgliteJournal,
  createPgliteLedger,
  HEADS_OVERLAP_MS,
  type LedgerDb,
} from './pglite-ledger.js';
export {
  MalformedServerRowError,
  parseDocumentId,
  parseHeadRows,
  parseWriterId,
  type RefusedHead,
} from './server-rows.js';
export { createSupabaseTransport } from './supabase-transport.js';
export type {
  PullResult,
  PushResult,
  SyncableDocument,
  SyncDocumentHead,
  SyncHead,
  SyncHeadsPage,
  SyncJournal,
  SyncLedger,
  SyncTailRow,
  SyncTransport,
} from './types.js';
