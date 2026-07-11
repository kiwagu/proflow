import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Typed view of the `kb` application-satellite schema for supabase-js.
 *
 * The generated `@workspace/db` `Database` type covers only `public` /
 * `graphql_public`; `kb` is a SEPARATE Postgres schema exposed through PostgREST via
 * `PGRST_DB_SCHEMAS += kb`. To reach those tables with the SAME RLS-scoped client
 * (`db.schema('kb')`) we describe their row shapes here — a thin, hand-maintained
 * mirror of the migration, NOT a second authority (RLS on each table is the
 * authority). It grows ONE satellite at a time, as the migration does.
 */

type SatelliteBase = {
  id: string;
  node_id: string;
  space_id: string;
  created_at: string;
  updated_at: string;
};

type DescriptionRow = SatelliteBase & { body: string; created_by: string };

/**
 * `resource_link` (prefix `krl`, slice-10 §2.4) — the 1:1 URL satellite that makes
 * a `kind=link` node real. `host` is the denormalized display host, derived
 * server-side from the validated URL at write time (never client-supplied).
 */
type LinkRow = SatelliteBase & {
  url: string;
  host: string | null;
  created_by: string;
};

type LinkInsert = {
  node_id: string;
  space_id: string;
  url: string;
  host?: string | null;
  created_by: string;
};

type LinkUpdate = {
  url?: string;
  host?: string | null;
};

/**
 * `resource_media_meta` (prefix `kmm`) — the generic 1:1 media satellite
 * keyed by `node_id` — a thin REFERENCE `{node_id → blob_id}` to a
 * shared `media_blob` plus the per-reference display filename. Byte-intrinsic
 * metadata lives on the blob; the BYTES live in the private `kb-media` bucket.
 */
type MediaMetaRow = SatelliteBase & {
  blob_id: string;
  original_filename: string;
  created_by: string;
};

type MediaMetaInsert = {
  node_id: string;
  space_id: string;
  blob_id: string;
  original_filename: string;
  created_by: string;
};

type MediaMetaUpdate = {
  blob_id?: string;
  original_filename?: string;
};

/**
 * `media_blob` (prefix `kmb`) — the immutable, reference-counted byte
 * record N kmm references share. `refcount` is trigger-owned (read-only here);
 * UPDATE/DELETE are not granted to `authenticated` at all — the app only INSERTs
 * a reservation (authorize) and SELECTs (download/purge decisions). The FK-less
 * `provenance_author_id` is the display-only "zero author".
 */
type MediaBlobRow = {
  id: string;
  space_id: string;
  storage_bucket: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  checksum: string | null;
  duration_ms: number | null;
  refcount: number;
  provenance_author_id: string | null;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
};

type MediaBlobInsert = {
  id: string;
  space_id: string;
  storage_bucket?: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  checksum?: string | null;
  duration_ms?: number | null;
  provenance_author_id?: string | null;
  uploaded_by: string;
};

// UPDATE is service-role-only in practice (not granted to authenticated; the
// reconcile reaper heals refcount drift) — typed here so the reaper stays clean.
type MediaBlobUpdate = {
  refcount?: number;
  checksum?: string | null;
};

/**
 * `resource_activity` (prefix `kra`) — the append-only activity-log
 * spine. NOT the 1:1 `node_id` satellite shape: it is 1:N keyed by `resource_id`,
 * with a `user_id` (per-user open) / `source` discriminator / `event_id` dedupe.
 */
type ResourceActivityRow = {
  id: string;
  space_id: string;
  resource_id: string;
  user_id: string | null;
  kind: string;
  source: 'pg-trigger' | 'nats-body' | 'open';
  event_id: string | null;
  occurred_at: string;
  created_at: string;
};

type ResourceActivityInsert = {
  space_id: string;
  resource_id: string;
  user_id?: string | null;
  kind: string;
  source: 'pg-trigger' | 'nats-body' | 'open';
  event_id?: string | null;
  occurred_at?: string;
};

type SatelliteTable<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type KbDatabase = {
  kb: {
    Tables: {
      resource_description: SatelliteTable<
        DescriptionRow,
        { node_id: string; space_id: string; body: string; created_by: string },
        { body?: string }
      >;
      resource_link: SatelliteTable<LinkRow, LinkInsert, LinkUpdate>;
      resource_activity: SatelliteTable<
        ResourceActivityRow,
        ResourceActivityInsert,
        never
      >;
      resource_media_meta: SatelliteTable<
        MediaMetaRow,
        MediaMetaInsert,
        MediaMetaUpdate
      >;
      media_blob: SatelliteTable<
        MediaBlobRow,
        MediaBlobInsert,
        MediaBlobUpdate
      >;
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

/**
 * A supabase-js client scoped to the `kb` schema. `db.schema('kb')` returns a
 * client whose generic is the `kb` schema definition — RLS still applies natively
 * (same JWT). The cast is the seam between the public-only generated `Database` and
 * the hand-typed `kb` schema; it never grants extra access (PostgREST enforces RLS
 * regardless of the TS type).
 */
export function kbSchema(db: SupabaseClient<Database>) {
  return (db as unknown as SupabaseClient<KbDatabase>).schema('kb');
}
