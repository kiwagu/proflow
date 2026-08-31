import type {
  IBlobStore,
  IPackageRepository,
  IPackageStore,
  PackageEntry,
  PackageInfo,
  PackageManifest,
} from '@workspace/domain';
import { err, ok } from 'neverthrow';
import type { AppDb } from '../db/db.js';

/** A kind plugin, as the repository needs it; the registry lives outside. */
export interface PackageKindLike {
  readonly kind: string;
  detect(entries: readonly PackageEntry[]): boolean;
  manifest(
    entries: readonly PackageEntry[],
    read: (path: string) => Promise<string | null>
  ): Promise<PackageManifest>;
}

type PackageRow = {
  hash: string;
  kind: string;
  manifest: PackageManifest;
  created_at: string | Date;
};

const toInfo = (row: PackageRow): PackageInfo => ({
  hash: row.hash,
  kind: row.kind,
  manifest: row.manifest,
  createdAt: new Date(row.created_at),
});

/**
 * Packages: unpack an archive the blob store already holds, let the first
 * kind that recognises it read its manifest, and index the entries.
 *
 * `readEntry` is the one gate untrusted content reaches the bytes
 * through. The path is confined by the store; what the index does not
 * list is not served; and every refusal is recorded.
 */
export function createPglitePackageRepository(
  db: AppDb,
  blobs: IBlobStore,
  store: IPackageStore,
  kinds: readonly PackageKindLike[]
): IPackageRepository {
  async function readText(hash: string, path: string) {
    const blob = await store.readEntry(hash, path);
    return blob ? blob.text() : null;
  }

  const repo: IPackageRepository = {
    async importArchive(hash, onProgress) {
      try {
        const existing = await repo.get(hash);
        if (existing.isOk() && existing.value) return ok(existing.value);

        const archive = await blobs.get(hash);
        if (!archive) return err(`blob ${hash} not found`);
        const entries = await store.unpack(hash, archive, onProgress);
        const kind = kinds.find((k) => k.detect(entries));
        if (!kind) return err('no package kind claims this archive');
        const manifest = await kind.manifest(entries, (path) =>
          readText(hash, path)
        );

        // The package row and its whole index in ONE statement. Every
        // query here is a round-trip that waits on a durable flush, so a
        // row-at-a-time loop over a package's hundreds of small files —
        // not the unzipping — was the wait this used to cost.
        const { rows } = await db.query<PackageRow>(
          `with saved as (
             insert into package (hash, kind, manifest) values ($1, $2, $3)
             on conflict (hash) do update
               set kind = excluded.kind, manifest = excluded.manifest
             returning hash, kind, manifest, created_at
           ), cleared as (
             delete from package_entry where hash = $1
           ), inserted as (
             insert into package_entry (hash, path, size, mime)
             select $1, * from unnest($4::text[], $5::bigint[], $6::text[])
           )
           select * from saved`,
          [
            hash,
            kind.kind,
            JSON.stringify(manifest),
            entries.map((e) => e.path),
            entries.map((e) => e.size),
            entries.map((e) => e.mime),
          ]
        );
        const row = rows[0];
        return row ? ok(toInfo(row)) : err('package insert returned no row');
      } catch (e) {
        return err(`package.importArchive failed: ${String(e)}`);
      }
    },

    async get(hash) {
      try {
        const { rows } = await db.query<PackageRow>(
          'select hash, kind, manifest, created_at from package where hash = $1',
          [hash]
        );
        return ok(rows[0] ? toInfo(rows[0]) : null);
      } catch (e) {
        return err(`package.get failed: ${String(e)}`);
      }
    },

    async discardUnpacked(hash) {
      try {
        // The rows go first: an index that outlived its files would serve
        // paths nothing can read. `package_entry`, `package_state` and
        // `package_audit` follow by cascade.
        await db.query('delete from package where hash = $1', [hash]);
        await store.remove(hash);
        return ok(undefined);
      } catch (e) {
        return err(`package.discardUnpacked failed: ${String(e)}`);
      }
    },

    async preview(hash) {
      try {
        const archive = await blobs.get(hash);
        if (!archive) return err(`blob ${hash} not found`);
        const entries = await store.inspect(archive);
        const kind = kinds.find((k) => k.detect(entries));
        const launchHint =
          entries.find((e) => /(^|\/)imsmanifest\.xml$/i.test(e.path))?.path ??
          entries.find((e) => /(^|\/)index\.x?html?$/i.test(e.path))?.path;
        return ok({
          kind: kind?.kind ?? 'archive',
          entryCount: entries.length,
          totalSize: entries.reduce((sum, e) => sum + e.size, 0),
          ...(launchHint ? { launchHint } : {}),
        });
      } catch (e) {
        return err(`package.preview failed: ${String(e)}`);
      }
    },

    async entries(hash) {
      try {
        const { rows } = await db.query<{
          path: string;
          size: number | string;
          mime: string;
        }>(
          'select path, size, mime from package_entry where hash = $1 order by path',
          [hash]
        );
        return ok(rows.map((r) => ({ ...r, size: Number(r.size) })));
      } catch (e) {
        return err(`package.entries failed: ${String(e)}`);
      }
    },

    async readEntry(hash, path) {
      try {
        const blob = await store.readEntry(hash, path);
        if (blob === null) {
          // Either the path could not be confined or there is no such
          // entry; both are worth a row, only the first is an attack.
          await repo.audit(hash, { op: 'read', path, allowed: false });
        }
        return ok(blob);
      } catch (e) {
        return err(`package.readEntry failed: ${String(e)}`);
      }
    },

    async getState(hash, context) {
      try {
        const { rows } = await db.query<{ state: Record<string, unknown> }>(
          'select state from package_state where hash = $1 and context = $2',
          [hash, context]
        );
        return ok(rows[0]?.state ?? {});
      } catch (e) {
        return err(`package.getState failed: ${String(e)}`);
      }
    },

    async setState(hash, context, state) {
      try {
        await db.query(
          `insert into package_state (hash, context, state) values ($1, $2, $3)
           on conflict (hash, context) do update
             set state = excluded.state, updated_at = now()`,
          [hash, context, JSON.stringify(state)]
        );
        return ok(undefined);
      } catch (e) {
        return err(`package.setState failed: ${String(e)}`);
      }
    },

    async audit(hash, event) {
      try {
        await db.query(
          'insert into package_audit (hash, op, path, allowed) values ($1, $2, $3, $4)',
          [hash, event.op, event.path, event.allowed]
        );
      } catch {
        // The audit trail must never break the thing it observes.
      }
    },
  };
  return repo;
}
