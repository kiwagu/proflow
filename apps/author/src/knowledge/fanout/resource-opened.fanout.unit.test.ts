import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { recordResourceOpened } from './resource-opened.fanout';

/**
 * Fan-out shape unit test (no live stack): `recordResourceOpened` must, under the
 * user's RLS-scoped `db`, APPEND the authoritative `open` activity row to
 * `kb.resource_activity` (`kind=open`, `source=open`, `user_id` from the session)
 * and nothing else. It writes NO `resource_user_state` row — the SECURITY DEFINER
 * roll-up trigger owns the anchor (it upserts it and advances `last_opened_at`),
 * which keeps "opened by me" honest for every member without the `progress` verb.
 * The append result determines `ok`.
 */

type InsertCall = { table: string; row: Record<string, unknown> };

function mockDb(opts: { activityError?: { message: string } | null }): {
  db: SupabaseClient<Database>;
  inserts: InsertCall[];
  publicFrom: ReturnType<typeof vi.fn>;
} {
  const inserts: InsertCall[] = [];

  // kb path: db.schema('kb').from('resource_activity').insert(...)
  const kbFrom = (table: string) => ({
    insert: (row: Record<string, unknown>) => {
      inserts.push({ table, row });
      return Promise.resolve({
        data: null,
        error: opts.activityError ?? null,
      });
    },
  });

  // public.* path must NOT be used by this fan-out anymore.
  const publicFrom = vi.fn();

  const db = {
    from: publicFrom,
    schema: vi.fn((name: string) => {
      expect(name).toBe('kb');
      return { from: vi.fn(kbFrom) };
    }),
  } as unknown as SupabaseClient<Database>;

  return { db, inserts, publicFrom };
}

describe('recordResourceOpened', () => {
  const input = { spaceId: 'spc_abc', nodeId: 'knr_xyz' };
  const userId = 'user-uuid-1';

  it('appends an open row (kind=open, source=open, session user_id) and writes no anchor', async () => {
    const { db, inserts, publicFrom } = mockDb({ activityError: null });
    const result = await recordResourceOpened(input, { db, userId });

    expect(result).toEqual({ ok: true, recorded: true });

    // the fan-out never touches resource_user_state — the definer roll-up owns it.
    expect(publicFrom).not.toHaveBeenCalled();

    // authoritative open append.
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe('resource_activity');
    expect(inserts[0].row).toEqual({
      space_id: 'spc_abc',
      resource_id: 'knr_xyz',
      user_id: userId,
      kind: 'open',
      source: 'open',
    });
  });

  it('returns a clean no-op when the open append is RLS-rejected', async () => {
    const { db } = mockDb({ activityError: { message: 'RLS denied' } });
    const result = await recordResourceOpened(input, { db, userId });
    expect(result).toEqual({ ok: false, recorded: false });
  });
});
