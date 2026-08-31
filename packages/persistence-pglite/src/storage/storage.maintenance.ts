import type {
  IBlobStore,
  IFileRepository,
  IPackageStore,
  IStorageMaintenance,
  StorageReport,
} from '@workspace/domain';
import { err, ok } from 'neverthrow';
import type { AppDb } from '../db/db.js';
import { deleteLocalDatabase } from '../db/db.js';
import {
  type PackMaintenance,
  packMaintenance,
} from '../db/pack/maintenance.js';

/**
 * Looking after the space the app occupies.
 *
 * Two halves have to agree for any of this to be answerable: the database
 * knows what is still wanted, the store knows what is actually on disk.
 * Content addressing puts them deliberately out of each other's reach —
 * bytes are named by what they are, never by who wants them — so the only
 * way to tell used from unused is to compare the two lists. That is also
 * why a schema that was rebuilt leaves bytes behind: the side that
 * remembered them is the side that was replaced.
 */
export function createPgliteStorageMaintenance(
  db: AppDb,
  blobs: IBlobStore,
  packages: IPackageStore,
  files: IFileRepository,
  // The database file's own maintenance answers over a broadcast channel
  // from the worker that holds it; a test hands in a stand-in instead.
  pack: PackMaintenance = packMaintenance
): IStorageMaintenance {
  /** Hashes the database still names, from either side of a file node. */
  async function referenced(): Promise<Set<string>> {
    const { rows } = await db.query<{ hash: string }>(
      `select b.hash from blob b
       where exists (
         select 1 from file_node f
         where f.blob_hash = b.hash and f.deleted_at is null
       )
       or exists (
         select 1 from document_content dc
         join document d on d.id = dc.document_id
         where d.deleted_at is null and position(b.hash in dc.markdown) > 0
       )`
    );
    return new Set(rows.map((row) => row.hash));
  }

  return {
    async report() {
      try {
        const estimate = await globalThis.navigator?.storage
          ?.estimate?.()
          .catch(() => undefined);
        const [stored, unpacked, wanted, packStats] = await Promise.all([
          blobs.list(),
          packages.list(),
          referenced(),
          pack.stats(),
        ]);
        const total = (list: ReadonlyArray<{ size: number }>) =>
          list.reduce((sum, item) => sum + item.size, 0);
        const live = stored.filter((item) => wanted.has(item.hash));
        // An unpacked area whose archive nobody wants any more is as
        // reclaimable as the archive itself.
        const strayPackages = unpacked.filter((item) => !wanted.has(item.hash));
        return ok<StorageReport, string>({
          used: estimate?.usage ?? null,
          quota: estimate?.quota ?? null,
          files: total(live),
          unpacked: total(unpacked),
          database: packStats?.packBytes ?? 0,
          reclaimable:
            total(stored) -
            total(live) +
            total(strayPackages) +
            (packStats?.freeBytes ?? 0),
        });
      } catch (e) {
        return err(`storage.report failed: ${String(e)}`);
      }
    },

    async freeUnused() {
      try {
        const before = await blobs.list();
        const beforePackages = await packages.list();
        // What the database can see: nodes the user deleted, and the rows
        // whose bytes nothing names any more.
        const collected = await files.collectGarbage();
        if (collected.isErr()) return err(collected.error);
        // What it cannot: bytes the database has no row for at all. A
        // schema rebuilt from empty leaves every stored file in exactly
        // that state — present, and wanted by nobody.
        const wanted = await referenced();
        let freed = 0;
        for (const item of before) {
          if (wanted.has(item.hash)) continue;
          await blobs.delete(item.hash);
          freed += item.size;
        }
        for (const item of beforePackages) {
          if (wanted.has(item.hash)) continue;
          await packages.remove(item.hash);
          freed += item.size;
        }
        // The database's own slack: blocks its files gave up and the pack
        // kept. Packing them away is the store's job; it answers with what
        // it returned to the disk.
        freed += (await pack.compact()) ?? 0;
        return ok(freed);
      } catch (e) {
        return err(`storage.freeUnused failed: ${String(e)}`);
      }
    },

    async deleteEverything() {
      try {
        // The store first: it is the half that survives a database that
        // has gone. Doing it the other way round and failing halfway
        // would leave bytes nothing can name — the very state this whole
        // module exists to clean up.
        await blobs.clear();
        await deleteLocalDatabase(db);
        return ok(undefined);
      } catch (e) {
        return err(`storage.deleteEverything failed: ${String(e)}`);
      }
    },
  };
}
