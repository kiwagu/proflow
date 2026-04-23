import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import {
  connectPayloadMongo,
  findPayloadUserBySupabaseSub,
} from './helpers/payload-mongo-user.js';
import {
  resolveServiceRoleKey,
  resolveSupabaseUrl,
} from './helpers/test-user.js';

/**
 * End-to-end: Supabase Auth admin create/delete → Postgres INSERT/DELETE triggers (+ optional GoTrue after-user-created) → Author Payload `users`.
 *
 * Requires a running stack with:
 * - Baseline migration identity_sync triggers + `make db-push` / internal_secret sync
 * - GoTrue after-user-created enabled in compose (public signup path)
 * - NATS in base Supabase compose; apps/author `NATS_URL` (e.g. `nats://127.0.0.1:4222`); `bun run dev` in apps/author runs Next + JetStream worker.
 * - `E2E_AUTHOR_MONGO_URL` (same as apps/author `MONGO_URL`) for assertions
 *
 * Tagged `@full` — not part of default `@smoke` (infra-heavy).
 */

function identitySyncMongoUrl(): string | undefined {
  const v = process.env.E2E_AUTHOR_MONGO_URL?.trim();
  return v || undefined;
}

function randomSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

test.describe('identity sync (Supabase → Author Payload) @full', () => {
  test.describe.configure({ timeout: 120_000 });

  test('create user in Auth then delete — Payload users row appears and is removed', async () => {
    const mongoUrlRaw = identitySyncMongoUrl();
    test.skip(
      !mongoUrlRaw,
      'Set E2E_AUTHOR_MONGO_URL (copy MONGO_URL from apps/author/.env) to assert Payload after hooks + fan-out.'
    );
    const mongoUrl = mongoUrlRaw as string;

    const url = resolveSupabaseUrl();
    const serviceRoleKey = resolveServiceRoleKey();
    const supabase = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const mongoClient = await connectPayloadMongo(mongoUrl);
    try {
      const email = `e2e-identity-${randomSuffix()}@example.test`;
      const password = `Pw!${randomSuffix()}Aa9`;

      const created = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

      if (created.error || !created.data.user) {
        throw new Error(
          `auth.admin.createUser failed: ${created.error?.message ?? 'no user'}`
        );
      }

      const userId = created.data.user.id;
      let deletedFromAuth = false;

      try {
        await expect
          .poll(
            async () =>
              findPayloadUserBySupabaseSub(mongoClient, mongoUrl, userId),
            {
              timeout: 90_000,
              intervals: [400, 800, 1_600, 3_200, 5_000],
            }
          )
          .not.toBeNull();

        const removed = await supabase.auth.admin.deleteUser(userId);
        if (removed.error) {
          throw new Error(
            `auth.admin.deleteUser failed: ${removed.error.message}`
          );
        }
        deletedFromAuth = true;

        await expect
          .poll(
            async () =>
              findPayloadUserBySupabaseSub(mongoClient, mongoUrl, userId),
            {
              timeout: 90_000,
              intervals: [400, 800, 1_600, 3_200, 5_000],
            }
          )
          .toBeNull();
      } finally {
        if (!deletedFromAuth) {
          await supabase.from('profiles').delete().eq('user_id', userId);
          await supabase.auth.admin.deleteUser(userId).catch(() => {
            /* best-effort */
          });
        }
      }
    } finally {
      await mongoClient.close();
    }
  });
});
