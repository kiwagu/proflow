import type { ISettingsStore } from '@workspace/domain';
import { err, ok } from 'neverthrow';
import type { AppDb } from '../db/db.js';

export function createPgliteSettingsStore(db: AppDb): ISettingsStore {
  return {
    async get(key) {
      try {
        const { rows } = await db.query<{ value: string }>(
          'select value from setting where key = $1',
          [key]
        );
        return ok(rows[0]?.value ?? null);
      } catch (e) {
        return err(`settings.get failed: ${String(e)}`);
      }
    },
    async set(key, value) {
      try {
        await db.query(
          `insert into setting (key, value) values ($1, $2)
           on conflict (key) do update set value = excluded.value, updated_at = now()`,
          [key, value]
        );
        return ok(undefined);
      } catch (e) {
        return err(`settings.set failed: ${String(e)}`);
      }
    },
    async remove(key) {
      try {
        await db.query('delete from setting where key = $1', [key]);
        return ok(undefined);
      } catch (e) {
        return err(`settings.remove failed: ${String(e)}`);
      }
    },
  };
}
