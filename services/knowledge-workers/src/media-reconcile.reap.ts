/**
 * KB media reconcile reaper — the plan/apply core. The ONLY
 * sanctioned `service_role` user on the media path (a
 * background job off every user request), and the authoritative backstop the
 * refcount model leans on:
 *
 *  (a) HEAL refcount drift — recompute each blob's true reference count from the
 *      actual `kmm` rows and overwrite a diverged stored `refcount` (the stored
 *      column is trigger-owned and normally exact; drift = a bug or a partial
 *      failure, healed rather than trusted).
 *  (b) REAP dead blobs — a blob with ZERO actual references older than the grace
 *      window loses its object (storage API `remove`, never a direct
 *      `storage.objects` DELETE — the metadata row alone would not free bytes)
 *      and then its row. Covers: confirm-failed uploads (bytes landed, no kmm),
 *      abandoned reservations (no bytes at all — remove is a no-op), and
 *      last-ref purge residue/races (the synchronous reap missed; refcount 0).
 *  (c) SWEEP stray objects — a `kb-media` object whose path matches NO blob row
 *      (a deleted blob's leftover, a malformed write) older than the grace
 *      window is removed.
 *
 * The GRACE window is the safety fence for in-flight work: an authorize creates
 * the blob row BEFORE the bytes move and a resumable session may run for hours
 * (upload TTL 6h), so nothing younger than the grace is ever touched. LIVE data
 * is protected structurally: a blob with ≥1 actual reference is never a
 * candidate, and an object whose path belongs to such a blob is never stray.
 *
 * Residual (documented, out of scope): hard-crash TUS PARTIALS on the file
 * backend live on the storage VOLUME (a file-store configstore), invisible to
 * every API — reaping those needs a disk-level sidecar.
 *
 * PLAN (pure, unit-testable) is separated from APPLY (service-role I/O).
 */
import type { Database } from '@workspace/db';
import { KB_MEDIA_BUCKET } from '@workspace/knowledge-contracts';
import type { SupabaseClient } from '@supabase/supabase-js';

import { kbSchema } from '@workspace/db/kb-schema';

/**
 * A minimal typed view of `storage.objects` for the READ-only stray sweep (the
 * generated `Database` type covers `public` only) — the same thin hand-typed
 * seam `kbSchema` uses; RLS/permissions stay the authority regardless.
 */
type StorageObjectsSchema = {
  storage: {
    Tables: {
      objects: {
        Row: { name: string; created_at: string; bucket_id: string };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

function storageSchema(db: SupabaseClient<Database>) {
  return (db as unknown as SupabaseClient<StorageObjectsSchema>).schema(
    'storage'
  );
}

/** Nothing younger than this is ever touched — covers authorize→PUT→confirm plus
 * a multi-hour resumable session with margin (upload TTL 6h). Code constant, not
 * env (monorepo-env-minimalism). */
export const MEDIA_REAP_GRACE_MS = 24 * 60 * 60 * 1000;

export type ReconcileBlob = {
  id: string;
  space_id: string;
  refcount: number;
  storage_bucket: string;
  storage_path: string;
  created_at: string;
};

export type ReconcilePlan = {
  /** blobId → true count, for stored refcounts that diverged (heal). */
  refcountFixes: Array<{ blobId: string; refcount: number }>;
  /**
   * Dead blobs (0 actual refs, past grace): drop the row; also remove the
   * object when `path` is non-null (a kb-media path scoped to the blob). `path`
   * is null for a malformed row we refuse to hand to storage.remove() — the row
   * is still dropped, but NO bytes are touched.
   */
  blobReaps: Array<{ blobId: string; bucket: string; path: string | null }>;
  /** Objects with NO blob row (past grace): remove via the storage API. */
  strayObjectPaths: string[];
};

/**
 * Decide the sweep — pure over a consistent snapshot. `kmmBlobIds` is the raw
 * `blob_id` list of ALL current references (one entry per kmm row).
 */
export function planReconcile(input: {
  blobs: ReconcileBlob[];
  kmmBlobIds: string[];
  objectPaths: Array<{ name: string; created_at: string }>;
  nowMs: number;
  graceMs?: number;
}): ReconcilePlan {
  const graceMs = input.graceMs ?? MEDIA_REAP_GRACE_MS;
  const cutoff = input.nowMs - graceMs;
  const pastGrace = (createdAt: string) => Date.parse(createdAt) < cutoff;

  const actualByBlob = new Map<string, number>();
  for (const blobId of input.kmmBlobIds) {
    actualByBlob.set(blobId, (actualByBlob.get(blobId) ?? 0) + 1);
  }

  const refcountFixes: ReconcilePlan['refcountFixes'] = [];
  const blobReaps: ReconcilePlan['blobReaps'] = [];
  const blobPaths = new Set<string>();
  for (const blob of input.blobs) {
    blobPaths.add(blob.storage_path);
    const actual = actualByBlob.get(blob.id) ?? 0;
    if (blob.refcount !== actual) {
      refcountFixes.push({ blobId: blob.id, refcount: actual });
    }
    if (actual === 0 && pastGrace(blob.created_at)) {
      // Defence-in-depth: the reaper deletes under
      // service-role (RLS-blind), so it NEVER trusts the row's stored bucket —
      // it removes ONLY from kb-media and ONLY a path scoped to this blob's own
      // space + id. The DB CHECK (media_blob_bucket_pinned / _path_scoped) makes a
      // malformed row unstorable; this is the belt in case one ever exists.
      const expectedPrefix = `spaces/${blob.space_id}/kb/blobs/${blob.id}/`;
      if (
        blob.storage_bucket === KB_MEDIA_BUCKET &&
        blob.storage_path.startsWith(expectedPrefix)
      ) {
        blobReaps.push({
          blobId: blob.id,
          bucket: KB_MEDIA_BUCKET,
          path: blob.storage_path,
        });
      }
      // else: still drop the dead row (below), but touch NO bytes — a
      // path/bucket we refuse to hand to storage.remove().
      else {
        blobReaps.push({
          blobId: blob.id,
          bucket: KB_MEDIA_BUCKET,
          path: null,
        });
      }
    }
  }

  const strayObjectPaths = input.objectPaths
    .filter((obj) => !blobPaths.has(obj.name) && pastGrace(obj.created_at))
    .map((obj) => obj.name);

  return { refcountFixes, blobReaps, strayObjectPaths };
}

export type ReconcileResult = {
  healed: number;
  blobsReaped: number;
  straysReaped: number;
};

/**
 * One full sweep: snapshot → plan → apply, under the SERVICE-ROLE client
 * (bypasses RLS; holds the table privileges the migration grants). Object
 * removal goes through the storage API (a direct `storage.objects` DELETE would
 * not free the physical bytes). Idempotent — a re-run over the same state
 * no-ops; failures are per-item and never abort the sweep.
 */
export async function runMediaReconcileSweep(
  service: SupabaseClient<Database>,
  opts?: { graceMs?: number; log?: (line: string) => void }
): Promise<ReconcileResult> {
  const log = opts?.log ?? (() => undefined);
  const kb = kbSchema(service);

  const { data: blobRows, error: blobsErr } = await kb
    .from('media_blob')
    .select('id,space_id,refcount,storage_bucket,storage_path,created_at');
  if (blobsErr) {
    throw new Error(`media reconcile: blobs read — ${blobsErr.message}`);
  }
  const { data: kmmRows, error: kmmErr } = await kb
    .from('resource_media_meta')
    .select('blob_id');
  if (kmmErr) {
    throw new Error(`media reconcile: kmm read — ${kmmErr.message}`);
  }
  // storage.objects via PostgREST (schema `storage` is exposed): READ-only here;
  // removal always goes through the storage API.
  const { data: objectRows, error: objErr } = await storageSchema(service)
    .from('objects')
    .select('name,created_at')
    .eq('bucket_id', KB_MEDIA_BUCKET);
  if (objErr) {
    throw new Error(`media reconcile: objects read — ${objErr.message}`);
  }

  const plan = planReconcile({
    blobs: blobRows ?? [],
    kmmBlobIds: (kmmRows ?? []).map((row) => row.blob_id),
    objectPaths: objectRows ?? [],
    nowMs: Date.now(),
    graceMs: opts?.graceMs,
  });

  let healed = 0;
  for (const fix of plan.refcountFixes) {
    const { error } = await kb
      .from('media_blob')
      .update({ refcount: fix.refcount })
      .eq('id', fix.blobId);
    if (error) {
      log(`heal ${fix.blobId} failed: ${error.message}`);
    } else {
      healed += 1;
      log(`healed refcount ${fix.blobId} → ${fix.refcount}`);
    }
  }

  let blobsReaped = 0;
  for (const reap of plan.blobReaps) {
    // Object first (an abandoned reservation has none — remove() failing is
    // fine), then the row; FK RESTRICT is naturally satisfied (0 references).
    // `path === null` = a malformed/mistrusted row: drop the row, touch NO bytes.
    if (reap.path !== null) {
      try {
        await service.storage.from(reap.bucket).remove([reap.path]);
      } catch {
        // Best-effort — a missing object must not keep the dead row alive.
      }
    }
    const { error } = await kb
      .from('media_blob')
      .delete()
      .eq('id', reap.blobId);
    if (error) {
      log(`blob reap ${reap.blobId} failed: ${error.message}`);
    } else {
      blobsReaped += 1;
      log(`reaped dead blob ${reap.blobId} (${reap.path})`);
    }
  }

  let straysReaped = 0;
  for (const path of plan.strayObjectPaths) {
    try {
      await service.storage.from(KB_MEDIA_BUCKET).remove([path]);
      straysReaped += 1;
      log(`reaped stray object ${path}`);
    } catch {
      log(`stray reap ${path} failed`);
    }
  }

  return { healed, blobsReaped, straysReaped };
}
