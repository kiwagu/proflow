import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@workspace/db';
import { fromByteaHex, toByteaHex } from './bytea.js';
import type { SyncHead, SyncTailRow, SyncTransport } from './types.js';

/**
 * The production transport: PostgREST tables plus one RPC, under the
 * caller's session (RLS enforced server-side). The schema IS the protocol —
 * no custom endpoint exists anywhere in this layer.
 */
export function createSupabaseTransport(
  client: SupabaseClient<Database>
): SyncTransport {
  return {
    async ensureDocument(docId, spaceId) {
      const user = await client.auth.getClaims();
      const uid = user.data?.claims.sub;
      if (!uid) throw new Error('no authenticated session for document sync');
      const { error } = await client
        .from('crdt_documents')
        .upsert(
          { id: docId, space_id: spaceId, created_by: uid },
          { onConflict: 'id', ignoreDuplicates: true }
        );
      if (error) throw new Error(`ensureDocument failed: ${error.message}`);
    },

    async head(docId): Promise<SyncHead> {
      const { data, error } = await client
        .from('crdt_documents')
        .select('snapshot, snapshot_seq')
        .eq('id', docId)
        .maybeSingle();
      if (error) throw new Error(`head query failed: ${error.message}`);
      return {
        snapshot: fromByteaHex(data?.snapshot ?? null),
        snapshotSeq: Number(data?.snapshot_seq ?? 0),
      };
    },

    async tail(docId, afterSeq): Promise<SyncTailRow[]> {
      const { data, error } = await client
        .from('crdt_updates')
        .select('seq, bytes, writer')
        .eq('doc_id', docId)
        .gt('seq', afterSeq)
        .order('seq', { ascending: true });
      if (error) throw new Error(`tail query failed: ${error.message}`);
      return (data ?? []).map((row) => {
        const bytes = fromByteaHex(row.bytes);
        if (!bytes) throw new Error(`update seq ${row.seq} has no bytes`);
        return { seq: Number(row.seq), bytes, writer: row.writer };
      });
    },

    async pushUpdate(docId, bytes, writer) {
      const user = await client.auth.getClaims();
      const uid = user.data?.claims.sub;
      if (!uid) throw new Error('no authenticated session for document sync');
      const { data, error } = await client
        .from('crdt_updates')
        .insert({
          doc_id: docId,
          bytes: toByteaHex(bytes),
          writer,
          created_by: uid,
        })
        .select('seq')
        .single();
      if (error) throw new Error(`push insert failed: ${error.message}`);
      return Number(data.seq);
    },

    async tailCount(docId) {
      const { count, error } = await client
        .from('crdt_updates')
        .select('*', { count: 'exact', head: true })
        .eq('doc_id', docId);
      if (error) throw new Error(`tail count failed: ${error.message}`);
      return count ?? 0;
    },

    async compact(docId, snapshot, coversSeq) {
      const { data, error } = await client.rpc('rpc_compact_document', {
        p_doc_id: docId,
        p_snapshot: toByteaHex(snapshot),
        p_covers_seq: coversSeq,
      });
      if (error) throw new Error(`compaction rpc failed: ${error.message}`);
      return data === true;
    },

    subscribeInserts(docId, onNudge) {
      // The payload is deliberately ignored: realtime is a nudge, never the
      // delivery mechanism. A dropped message costs latency (the poll still
      // runs), never data.
      let channel: RealtimeChannel | null = client
        .channel(`doc-sync:${docId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'crdt_updates',
            filter: `doc_id=eq.${docId}`,
          },
          () => onNudge()
        )
        .subscribe();
      return () => {
        if (channel) void client.removeChannel(channel);
        channel = null;
      };
    },

    async heads(spaceId, since, limit, offset) {
      let query = client
        .from('crdt_documents')
        .select('id, head_seq, updated_at')
        .eq('space_id', spaceId)
        // Id as tiebreaker: equal timestamps must order deterministically
        // or offset pages could overlap or skip between requests.
        .order('updated_at', { ascending: true })
        .order('id', { ascending: true })
        // One extra row answers "is there more?" without a count query.
        .range(offset, offset + limit);
      if (since) query = query.gte('updated_at', since.toISOString());
      const { data, error } = await query;
      if (error) throw new Error(`heads query failed: ${error.message}`);
      const rows = (data ?? []).map((row) => ({
        docId: row.id,
        headSeq: Number(row.head_seq),
        updatedAt: new Date(row.updated_at),
      }));
      return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
    },

    subscribeSpace(spaceId, onNudge) {
      let channel: RealtimeChannel | null = client
        .channel(`doc-sync:space:${spaceId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'crdt_documents',
            filter: `space_id=eq.${spaceId}`,
          },
          () => onNudge()
        )
        .subscribe();
      return () => {
        if (channel) void client.removeChannel(channel);
        channel = null;
      };
    },
  };
}
