import type { SupabaseClient } from '@supabase/supabase-js';

/** An authenticated participant — a user JWT client subject to RLS. */
export type SeedActor = {
  userId: string;
  email: string;
  password: string;
  /** Authenticated client (user JWT) — subject to RLS. */
  client: SupabaseClient;
};

/**
 * A provisioned tenant: org + space + three base actors. `granted` holds the
 * `admin` space role (all `space.knowledge.*` verbs); `ungranted` holds only
 * `space_admin` (no knowledge verbs) — the negative actor; `member` holds the
 * `member` role (read + create — can author its OWN content) and backs the catalog
 * `viewer` actor ref, so a scenario's `owner: 'viewer'` node authors in BOTH the
 * ephemeral and the demo tenant. `service` bypasses RLS for setup/assertions. Both
 * the ephemeral (e2e) and the stable demo tenant share this shape so every consumer
 * reads the same fields.
 *
 * IMPORTANT: `ungranted` is the VERB-LESS negative actor — several e2e specs read
 * `tenant.ungranted` directly and assert RLS denies it (cannot create/describe/fence,
 * sees zero domain rows). It is NOT the same as `member`; do NOT conflate them.
 */
export type SeedTenant = {
  organizationId: string;
  spaceId: string;
  granted: SeedActor;
  ungranted: SeedActor;
  /** `member`-role actor (read + create) — backs the catalog `viewer` ref so a
   * `owner: 'viewer'` node can author in both tenant modes. Distinct from the
   * verb-less `ungranted` negative actor. */
  member: SeedActor;
  /** Service-role client — bypasses RLS (setup/assertions only). */
  service: SupabaseClient;
};
