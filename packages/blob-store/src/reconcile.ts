import type {
  BlobInfo,
  IBlobStore,
  IBlobSyncLocal,
  IBlobSyncRemote,
} from '@workspace/domain';
import { hashBlob } from './hash.js';

/**
 * Media reconcile: the loop that keeps a device's content-addressed bytes and
 * their durable copy in agreement. It is deliberately a reconciler, not a
 * transfer protocol — there is no session, no resume token, no ledger. Every
 * step is idempotent because the key IS the content, so the loop's only job is
 * to notice a difference and act on it; interrupting it at any point costs at
 * most the work in flight.
 *
 * Push runs in the background over everything the device holds but has not
 * confirmed durable. Pull runs on demand: bytes are fetched the first time
 * something actually needs them, never eagerly on sync, so a new device does
 * not download a space's entire media before it can be used.
 */

/** How many pending blobs one push pass considers. Keeps a pass bounded so a
 * large backlog is drained over several cheap passes instead of one long one. */
const DEFAULT_PUSH_BATCH = 20;

export type PushOutcome =
  /** Bytes were uploaded and certified by this device. */
  | 'uploaded'
  /** Another device had already certified the same content. */
  | 'already-durable'
  /** The local store no longer holds the bytes (evicted or deleted). */
  | 'missing-locally';

export type PushResult = {
  uploaded: number;
  alreadyDurable: number;
  missingLocally: number;
  failed: number;
};

export type ReconcileDeps = {
  store: IBlobStore;
  local: IBlobSyncLocal;
  remote: IBlobSyncRemote;
  /** Diagnostics sink; failures are logged, never thrown at the caller. */
  log?: (line: string) => void;
};

/**
 * Pushes one blob. The order — check, upload, certify, mark — is the whole
 * durability argument:
 *
 *  1. A certificate already there means another device did the work; the bytes
 *     are content-identical by definition, so there is nothing to upload.
 *  2. Bytes go up BEFORE the certificate is written, so a certificate never
 *     describes an object that is not fully there.
 *  3. The local state advances only after the certificate is confirmed, so a
 *     crash anywhere above simply re-runs this function next pass.
 */
export async function pushBlob(
  deps: ReconcileDeps,
  info: BlobInfo
): Promise<PushOutcome> {
  if (await deps.remote.isCertified(info.hash)) {
    await deps.local.markSynced(info.hash);
    return 'already-durable';
  }

  const bytes = await deps.store.get(info.hash);
  if (!bytes) {
    // Nothing to push: the local copy is gone. Leaving the record pending is
    // correct — if the bytes ever come back (re-import, pull) it resumes.
    return 'missing-locally';
  }

  await deps.remote.putObject(info.hash, bytes);
  await deps.remote.certify(info);
  await deps.local.markSynced(info.hash);
  return 'uploaded';
}

/**
 * One push pass over the pending backlog. A per-blob failure is counted and
 * skipped rather than aborting the pass: one unreachable object must not block
 * every other blob behind it, and the next pass retries it for free.
 */
export async function runPushPass(
  deps: ReconcileDeps,
  opts?: { batch?: number }
): Promise<PushResult> {
  const pending = await deps.local.pending(opts?.batch ?? DEFAULT_PUSH_BATCH);
  const result: PushResult = {
    uploaded: 0,
    alreadyDurable: 0,
    missingLocally: 0,
    failed: 0,
  };

  for (const record of pending) {
    try {
      const outcome = await pushBlob(deps, record);
      if (outcome === 'uploaded') result.uploaded += 1;
      else if (outcome === 'already-durable') result.alreadyDurable += 1;
      else result.missingLocally += 1;
    } catch (error) {
      result.failed += 1;
      deps.log?.(
        `push ${record.hash} failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return result;
}

/**
 * Makes bytes available locally, fetching the durable copy if this device does
 * not hold them. This is the pull half, and it is what every read path calls
 * before opening a blob it may not have.
 *
 * Verification is structural rather than a separate check: the fetched bytes
 * are hashed and compared before they are stored, so a truncated or tampered
 * download cannot be written under a hash it does not have. That is also why a
 * mismatch is an error and not a silent retry — it means the transport or the
 * durable copy is wrong, which is worth surfacing.
 */
export async function ensureLocal(
  deps: ReconcileDeps,
  hash: string
): Promise<Blob | null> {
  const held = await deps.store.get(hash);
  if (held) return held;

  const fetched = await deps.remote.fetchObject(hash);
  if (!fetched) return null;

  const actual = await hashBlob(fetched);
  if (actual !== hash) {
    throw new Error(
      `blob ${hash} failed verification: durable copy hashed to ${actual}`
    );
  }

  const info = await deps.store.put(fetched);
  await deps.local.registerSynced(info);
  return deps.store.get(hash);
}
