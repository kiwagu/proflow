import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  HARD_MAX_UPLOAD_BYTES,
} from '@workspace/knowledge-contracts';
import {
  parseRuntimeSettingValue,
  RUNTIME_SETTING_KEYS,
} from '@workspace/settings-runtime';

/**
 * Resolve the effective MAX-UPLOAD size (bytes) for an upload targeting a node in
 * `spaceId`. An upload lands in a SPACE but the governance
 * dial is the ORG's, so the cascade is `organization → global → code default`, then
 * CLAMPED to the 5 GB hard system cap (§A4).
 *
 * REUSE (not reinvent): the value comes from the existing `runtime_settings`
 * registry (`platform.media.max_upload_bytes`, value_type `number`, `isPublic`).
 * Because the row is public, an org MEMBER (the uploader) can SELECT it under RLS —
 * so this is a plain RLS SELECT via the CALLER's `db`, NEVER service-role (the
 * upload path is user-scoped end-to-end). The org-scope SELECT is fenced
 * by `runtime_settings_actor_can_read_scope` (org membership required); the global
 * public row is readable by any authenticated caller.
 *
 * Fail-open is NOT possible here: an unreadable/absent row simply falls through the
 * cascade to the SOFT default — it can never RAISE the limit, and the final
 * `Math.min(..., HARD_MAX_UPLOAD_BYTES)` guarantees the ceiling regardless of any
 * stored value. The soft limit is a governance dial, not the byte fence (the
 * `storage.objects` INSERT RLS + the bucket `file_size_limit` are the fence).
 */
export async function resolveMediaMaxUploadBytes(
  db: SupabaseClient<Database>,
  spaceId: string
): Promise<number> {
  const organizationId = await resolveOrganizationIdForSpace(db, spaceId);

  const [organizationValue, globalValue] = await Promise.all([
    organizationId
      ? readNumericSetting(db, 'organization', organizationId)
      : Promise.resolve(null),
    readNumericSetting(db, 'global', null),
  ]);

  const resolved = organizationValue ?? globalValue ?? DEFAULT_MAX_UPLOAD_BYTES;

  return Math.min(resolved, HARD_MAX_UPLOAD_BYTES);
}

async function resolveOrganizationIdForSpace(
  db: SupabaseClient<Database>,
  spaceId: string
): Promise<string | null> {
  const { data } = await db
    .from('spaces')
    .select('organization_id')
    .eq('id', spaceId)
    .maybeSingle();

  return data?.organization_id ?? null;
}

async function readNumericSetting(
  db: SupabaseClient<Database>,
  scope: 'organization' | 'global',
  scopeId: string | null
): Promise<number | null> {
  let query = db
    .from('runtime_settings')
    .select('key,value')
    .eq('scope', scope)
    .eq('key', RUNTIME_SETTING_KEYS.mediaMaxUploadBytes);

  query = scopeId ? query.eq('scope_id', scopeId) : query.is('scope_id', null);

  const { data, error } = await query.maybeSingle();
  if (error || !data) {
    return null;
  }

  try {
    const parsed = parseRuntimeSettingValue(
      RUNTIME_SETTING_KEYS.mediaMaxUploadBytes,
      data.value
    );
    return typeof parsed === 'number' ? parsed : null;
  } catch {
    // A malformed stored value falls through the cascade (never raises the limit).
    return null;
  }
}
