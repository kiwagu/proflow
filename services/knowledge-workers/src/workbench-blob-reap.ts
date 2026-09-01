/**
 * Workbench blob reaper — the plan/apply core for reclaiming durable bytes
 * nobody references any more. Runs under the service role (RLS-blind), off
 * every user request, and is the ONLY deleter of workbench blob bytes: a
 * client's replica may lag arbitrarily, so a client cannot know whether some
 * other member still references a blob, while the server can.
 *
 * Two legs, deliberately independent:
 *
 *  (a) UNREFERENCED blobs — a certified blob no live reference names loses its
 *      metadata row and then its object. The ORDER is the whole safety
 *      argument and is the reverse of the writer's: the row certifies that the
 *      bytes are complete, so it must die BEFORE them. A crash in between
 *      leaves an orphaned object — invisible to every client, collected by leg
 *      (b) — never a surviving certificate promising bytes that are gone.
 *
 *  (b) ORPHANED objects — an object with no metadata row at all (a failed
 *      upload that never got certified, or leg (a)'s crash residue) is
 *      removed once it is past the grace window.
 *
 * The GRACE window is the fence around in-flight work: an upload may run for a
 * long time before its certificate is written, so nothing younger than the
 * grace is ever a candidate on either leg. Live data is additionally protected
 * structurally — a blob with at least one live reference is never a candidate,
 * and an object whose key belongs to a certified blob is never an orphan.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@workspace/db';

/** The private bucket holding one immutable object per content hash. */
export const WORKBENCH_BLOB_BUCKET = 'workbench-blobs';

/** Nothing younger than this is touched, on either leg. A code constant rather
 * than env: it is a correctness fence, not a deployment knob. */
export const WORKBENCH_REAP_GRACE_MS = 24 * 60 * 60 * 1000;

export type CertifiedBlob = {
  space_id: string;
  hash: string;
  created_at: string;
};

export type StorageObject = {
  name: string;
  created_at: string;
};

export type ReapPlan = {
  /** Certified blobs nothing references: drop the row, then the object. */
  blobReaps: Array<{ spaceId: string; hash: string; path: string }>;
  /** Object keys with no certificate at all, past grace. */
  orphanObjectPaths: string[];
};

export function blobObjectKey(spaceId: string, hash: string): string {
  return `spaces/${spaceId}/blobs/${hash}`;
}

/**
 * Parses an object key back into its space and hash, or null when the key does
 * not have the shape this bucket's policies enforce. A key that does not parse
 * is never handed to a delete: refusing to act on something we cannot explain
 * is cheaper than the one case where it was live data.
 */
export function parseBlobObjectKey(
  name: string
): { spaceId: string; hash: string } | null {
  const parts = name.split('/');
  if (parts.length !== 4) return null;
  const [root, spaceId, area, hash] = parts;
  if (root !== 'spaces' || area !== 'blobs') return null;
  if (!spaceId || !/^[0-9a-f]{64}$/.test(hash ?? '')) return null;
  return { spaceId, hash: hash! };
}

/**
 * Decides the sweep — pure over one consistent snapshot.
 *
 * `referenced` is the set of `space_id|hash` pairs that some live reference
 * names. It is passed in rather than read here because the reference source is
 * the file tree, whose server-side shape is owned by the row-sync layer; the
 * planner's logic does not change when that source arrives.
 */
export function planWorkbenchBlobReap(input: {
  blobs: CertifiedBlob[];
  referenced: ReadonlySet<string>;
  objects: StorageObject[];
  nowMs: number;
  graceMs?: number;
  /**
   * When false the unreferenced leg plans nothing, regardless of `referenced`.
   * The orphan leg is unaffected: it only needs to know which objects HAVE a
   * certificate, which `blobs` always answers.
   */
  reapUnreferenced?: boolean;
}): ReapPlan {
  const graceMs = input.graceMs ?? WORKBENCH_REAP_GRACE_MS;
  const cutoff = input.nowMs - graceMs;
  const pastGrace = (createdAt: string) => Date.parse(createdAt) < cutoff;

  const certifiedKeys = new Set<string>();
  const blobReaps: ReapPlan['blobReaps'] = [];

  for (const blob of input.blobs) {
    certifiedKeys.add(blobObjectKey(blob.space_id, blob.hash));
    if (input.reapUnreferenced === false) continue;
    if (input.referenced.has(`${blob.space_id}|${blob.hash}`)) continue;
    if (!pastGrace(blob.created_at)) continue;
    blobReaps.push({
      spaceId: blob.space_id,
      hash: blob.hash,
      path: blobObjectKey(blob.space_id, blob.hash),
    });
  }

  const orphanObjectPaths = input.objects
    .filter(
      (object) =>
        !certifiedKeys.has(object.name) &&
        parseBlobObjectKey(object.name) !== null &&
        pastGrace(object.created_at)
    )
    .map((object) => object.name);

  return { blobReaps, orphanObjectPaths };
}

export type ReapResult = {
  blobsReaped: number;
  orphansReaped: number;
};

/**
 * Where live references come from. The file tree that names blobs is a synced
 * row projection owned by the row-sync layer; until that table exists on the
 * server there is no source that can answer "is this blob still wanted", and
 * the sweep below refuses the unreferenced leg rather than guessing.
 */
export type ReferenceSource = (
  db: SupabaseClient<Database>
) => Promise<ReadonlySet<string>>;

export type SweepOptions = {
  graceMs?: number;
  log?: (line: string) => void;
  /**
   * Omitted = no reference source configured. The orphan leg still runs (it
   * needs no reference knowledge — an object with no certificate is unwanted
   * by construction), and the unreferenced leg is SKIPPED. Fail-closed: the
   * failure mode of guessing here is deleting a user's file.
   */
  references?: ReferenceSource;
};

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

/** A read-only typed view of `storage.objects` (the generated Database type
 * covers `public` only). Removal always goes through the storage API — a
 * direct row delete would not free the physical bytes. */
function storageSchema(db: SupabaseClient<Database>) {
  return (db as unknown as SupabaseClient<StorageObjectsSchema>).schema(
    'storage'
  );
}

/**
 * One full sweep: snapshot, plan, apply. Idempotent — re-running over the same
 * state no-ops — and per-item failures are logged without aborting the sweep,
 * because one unreachable object must not keep every other dead blob alive.
 */
export async function runWorkbenchBlobReap(
  service: SupabaseClient<Database>,
  opts?: SweepOptions
): Promise<ReapResult> {
  const log = opts?.log ?? (() => undefined);

  const { data: blobRows, error: blobsErr } = await service
    .from('workbench_blobs')
    .select('space_id,hash,created_at');
  if (blobsErr) {
    throw new Error(`workbench blob reap: certificates — ${blobsErr.message}`);
  }

  const { data: objectRows, error: objectsErr } = await storageSchema(service)
    .from('objects')
    .select('name,created_at')
    .eq('bucket_id', WORKBENCH_BLOB_BUCKET);
  if (objectsErr) {
    throw new Error(`workbench blob reap: objects — ${objectsErr.message}`);
  }

  let referenced: ReadonlySet<string> = new Set();
  const reapUnreferenced = Boolean(opts?.references);
  if (opts?.references) {
    referenced = await opts.references(service);
  } else {
    log(
      'no reference source configured — skipping the unreferenced-blob leg; sweeping orphaned objects only'
    );
  }

  const plan = planWorkbenchBlobReap({
    blobs: blobRows ?? [],
    referenced,
    objects: objectRows ?? [],
    nowMs: Date.now(),
    graceMs: opts?.graceMs,
    reapUnreferenced,
  });

  let blobsReaped = 0;
  for (const reap of plan.blobReaps) {
    // Row first, then bytes: the row is the certificate, and a certificate
    // must never outlive the object it vouches for.
    const { error } = await service
      .from('workbench_blobs')
      .delete()
      .eq('space_id', reap.spaceId)
      .eq('hash', reap.hash);
    if (error) {
      log(`blob reap ${reap.hash} failed: ${error.message}`);
      continue;
    }
    try {
      await service.storage.from(WORKBENCH_BLOB_BUCKET).remove([reap.path]);
    } catch {
      // The object is now an orphan; the next sweep's orphan leg collects it.
    }
    blobsReaped += 1;
    log(`reaped unreferenced blob ${reap.hash}`);
  }

  let orphansReaped = 0;
  for (const path of plan.orphanObjectPaths) {
    try {
      await service.storage.from(WORKBENCH_BLOB_BUCKET).remove([path]);
      orphansReaped += 1;
      log(`reaped orphaned object ${path}`);
    } catch {
      log(`orphan reap ${path} failed`);
    }
  }

  return { blobsReaped, orphansReaped };
}
