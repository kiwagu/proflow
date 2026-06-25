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
 * A provisioned tenant: org + space + two base actors. `granted` holds the
 * `admin` space role (all `space.knowledge.*` verbs); `ungranted` holds only
 * `space_admin` (no knowledge verbs) — the negative actor. `service` bypasses
 * RLS for setup/assertions. Both the ephemeral (e2e) and the stable demo tenant
 * share this shape so every consumer reads the same fields.
 */
export type SeedTenant = {
  organizationId: string;
  spaceId: string;
  granted: SeedActor;
  ungranted: SeedActor;
  /** Service-role client — bypasses RLS (setup/assertions only). */
  service: SupabaseClient;
};
