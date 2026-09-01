import entityId from './migrations/001_entity_id.sql?raw';
import documents from './migrations/002_documents.sql?raw';
import files from './migrations/003_files.sql?raw';
import packages from './migrations/004_packages.sql?raw';
import graph from './migrations/005_graph.sql?raw';

type Executor = {
  query: <T = unknown>(
    sql: string,
    params?: unknown[]
  ) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  transaction: <T>(cb: (tx: Tx) => Promise<T>) => Promise<T | undefined>;
};
type Tx = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  exec: (sql: string) => Promise<unknown>;
};

const MIGRATIONS: Array<{ version: number; sql: string }> = [
  { version: 1, sql: entityId },
  { version: 2, sql: documents },
  { version: 3, sql: files },
  { version: 4, sql: packages },
  { version: 5, sql: graph },
];

/**
 * Fingerprint of a migration's text. Not a security property — a drift
 * detector: it answers "is the schema in this database the one this build
 * would create?", which is the question an app that ships its schema inside
 * its bundle has to ask on every start.
 */
function checksum(sql: string): string {
  // FNV-1a, 32-bit.
  let hash = 0x811c9dc5;
  for (let i = 0; i < sql.length; i++) {
    hash ^= sql.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

const LEDGER = `create table if not exists schema_migration (
   version int primary key,
   checksum text not null default '',
   applied_at timestamptz not null default now()
 )`;

/**
 * How long to wait for another context to finish migrating before going
 * ahead anyway. The lock is held for as long as its holder's queries take,
 * and those queries go to whichever context won the leader election — so a
 * holder that is slow, frozen or stuck would otherwise wedge every other
 * tab's start-up for good. Waiting is the fast path, not a requirement:
 * `applyPending` re-checks the ledger and treats a version another context
 * applied first as applied.
 */
const LOCK_WAIT_MS = 10_000;

/**
 * Applies pending migrations in order; each runs in one transaction.
 *
 * Serialized with a Web Lock because every tab runs this against the SAME
 * database: non-leader tabs proxy their queries to the leader, so two tabs
 * booting together would both see "version 1 not applied" and both try to
 * create the schema. A Postgres advisory lock would not help — the tabs share
 * one connection, so the lock is re-entrant and grants both.
 */
export async function migrate(db: Executor): Promise<void> {
  // Fast path: is the schema exactly what this build would create? — the
  // answer on every start except the very first and the one after a schema
  // change. The existence probe keeps a fresh database from logging a
  // "relation does not exist" error: PGlite prints one before the catch
  // below would see it.
  const probe = await db
    .query<{ found: boolean }>(
      "select to_regclass('public.schema_migration') is not null as found"
    )
    .catch(() => null);
  if (probe?.rows[0]?.found) {
    const { rows } = await db.query<{ version: number; checksum: string }>(
      'select version, checksum from schema_migration'
    );
    const upToDate =
      rows.length === MIGRATIONS.length &&
      MIGRATIONS.every((m) =>
        rows.some(
          (row) => row.version === m.version && row.checksum === checksum(m.sql)
        )
      );
    if (upToDate) return;
  }
  const locks = globalThis.navigator?.locks;
  if (!locks) return applyPending(db);
  try {
    await locks.request(
      'proflow-migrate',
      { signal: AbortSignal.timeout(LOCK_WAIT_MS) },
      () => applyPending(db)
    );
  } catch (e) {
    // Only the wait was abandoned; anything the callback threw is real.
    if (!(e instanceof DOMException) || e.name !== 'TimeoutError') throw e;
    await applyPending(db);
  }
}

/**
 * Has an applied migration been rewritten since it ran here? A migration is
 * normally append-only, and then this is never true. It is true for a
 * database left behind by a schema generation this build no longer knows how
 * to reach — before the app has users, rewriting the schema and rebuilding
 * from empty is honest, and cheaper than carrying conversion steps nobody
 * will ever run again.
 */
async function isStale(db: Executor): Promise<boolean> {
  const { rows } = await db.query<{ version: number; checksum: string }>(
    'select version, checksum from schema_migration'
  );
  return rows.some((row) => {
    const migration = MIGRATIONS.find((m) => m.version === row.version);
    return !migration || checksum(migration.sql) !== row.checksum;
  });
}

async function applyPending(db: Executor): Promise<void> {
  await db.exec(LEDGER);
  // A ledger from before checksums were kept has the column but no values,
  // which reads as stale — correctly, since that schema predates this one.
  await db.exec(
    `alter table schema_migration add column if not exists checksum text not null default ''`
  );

  if (await isStale(db)) {
    // One transaction, so a database is never left half-rebuilt: either the
    // old schema stands or the new one does. Another tab that decided to
    // rebuild at the same moment finds a matching ledger when its turn
    // comes and does nothing.
    await db.transaction(async (tx) => {
      await tx.exec('drop schema public cascade; create schema public');
      await tx.exec(LEDGER);
      for (const migration of MIGRATIONS) {
        await tx.exec(migration.sql);
        await tx.query(
          'insert into schema_migration (version, checksum) values ($1, $2)',
          [migration.version, checksum(migration.sql)]
        );
      }
    });
    return;
  }

  for (const migration of MIGRATIONS) {
    const { rows } = await db.query(
      'select 1 from schema_migration where version = $1',
      [migration.version]
    );
    if (rows.length > 0) continue;
    try {
      await db.transaction(async (tx) => {
        await tx.exec(migration.sql);
        await tx.query(
          'insert into schema_migration (version, checksum) values ($1, $2)',
          [migration.version, checksum(migration.sql)]
        );
      });
    } catch (e) {
      // Another context may have applied this version while we were
      // reading: the ledger's primary key is what makes that safe to
      // discover here rather than prevent everywhere.
      const { rows: applied } = await db.query(
        'select 1 from schema_migration where version = $1',
        [migration.version]
      );
      if (applied.length === 0) throw e;
    }
  }
}
