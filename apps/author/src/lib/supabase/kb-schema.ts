import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Typed view of the `kb` application-satellite schema for supabase-js (ADR-0013).
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
