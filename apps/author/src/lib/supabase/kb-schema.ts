import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Typed view of the `kb` application-satellite schema for supabase-js.
 *
 * The generated `@workspace/db` `Database` type covers only `public` /
 * `graphql_public` (PostgREST type-gen is scoped there). The `kb` schema is a
 * SEPARATE Postgres schema (ADR-0013): node satellites keyed by `node_id`,
 * exposed through PostgREST via `PGRST_DB_SCHEMAS += kb`. To reach those tables
 * with the SAME user RLS-scoped client (`db.schema('kb')`) we describe their row
 * shapes here — a thin, hand-maintained mirror of the migration, NOT a second
 * authority (RLS on each table is the authority; this is only the TS row shape).
 *
 * This lives in the author app (next to the RLS client builders) rather than in
 * `@workspace/kb-contracts`, which stays a pure zod DTO package with no
 * supabase/db coupling. The zod contracts validate the wire payloads; this types
 * the PostgREST row I/O.
 */

type SatelliteBase = {
  id: string;
  node_id: string;
  space_id: string;
  created_at: string;
  updated_at: string;
};

type DescriptionRow = SatelliteBase & { body: string; created_by: string };
type ProvenanceRow = SatelliteBase & { source: 'human' | 'imported' | 'ai' };
type ActivityRow = SatelliteBase & { view_count: number };
type LinkRow = SatelliteBase & {
  url: string;
  host: string | null;
  created_by: string;
};
type MediaMetaRow = SatelliteBase & {
  byte_size: number | null;
  duration_ms: number | null;
  mime_type: string | null;
  created_by: string;
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
        {
          node_id: string;
          space_id: string;
          body: string;
          created_by: string;
        },
        { body?: string }
      >;
      resource_provenance: SatelliteTable<
        ProvenanceRow,
        {
          node_id: string;
          space_id: string;
          source: ProvenanceRow['source'];
        },
        { source?: ProvenanceRow['source'] }
      >;
      resource_activity: SatelliteTable<
        ActivityRow,
        { node_id: string; space_id: string; view_count?: number },
        { view_count?: number }
      >;
      resource_link: SatelliteTable<
        LinkRow,
        {
          node_id: string;
          space_id: string;
          url: string;
          host?: string | null;
          created_by: string;
        },
        { url?: string; host?: string | null }
      >;
      resource_media_meta: SatelliteTable<
        MediaMetaRow,
        {
          node_id: string;
          space_id: string;
          byte_size?: number | null;
          duration_ms?: number | null;
          mime_type?: string | null;
          created_by: string;
        },
        {
          byte_size?: number | null;
          duration_ms?: number | null;
          mime_type?: string | null;
        }
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
 * `PostgrestClient` whose generic is the `kb` schema definition — RLS still
 * applies natively (same JWT). The cast is the seam between the public-only
 * generated `Database` and the hand-typed `kb` schema; it never grants extra
 * access (PostgREST enforces RLS regardless of the TS type).
 */
export function kbSchema(db: SupabaseClient<Database>) {
  return (db as unknown as SupabaseClient<KbDatabase>).schema('kb');
}
