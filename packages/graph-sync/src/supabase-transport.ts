import type {
  PostgrestError,
  RealtimeChannel,
  SupabaseClient,
} from '@supabase/supabase-js';
import type { Database } from '@workspace/db';
import { parseServerIds, parseServerRows } from './server-rows.js';
import { describeTable, type GraphSyncTableName } from './tables.js';
import {
  GraphWriteError,
  type GraphRowTransport,
  type PullPage,
} from './types.js';

/**
 * The production transport: plain PostgREST under the caller's own session,
 * so RLS decides at the source what this replica may ever hold. There is no
 * custom sync endpoint anywhere — the schema IS the protocol, the same
 * stance the document sync layer takes.
 *
 * Two schemas are reached through the one client: `public` for the graph
 * itself and `kb` for the application satellites (exposed through the same
 * PostgREST instance). The typed client only knows `public`, so satellite
 * calls go through a narrowed cast — which grants nothing: PostgREST
 * enforces RLS regardless of what TypeScript believes.
 */

/**
 * PostgREST/Postgres codes that mean the server REACHED a verdict and it was
 * no. Everything else is treated as "no verdict" and retried, because
 * discarding a user's offline change on an ambiguous error is the one
 * failure this layer must not have.
 *
 *   42501 insufficient privilege — an RLS policy or a guard trigger's raise
 *   23xxx integrity violation — FK, unique, check
 *   P0001 raise_exception — the cycle guard, the trash authority guard
 *   PGRST301 / 401 / 403 — the request was rejected, not lost
 */
const REFUSAL_CODES = new Set([
  '42501',
  '23502',
  '23503',
  '23505',
  '23514',
  '23P01',
  'P0001',
  'PGRST301',
  '401',
  '403',
]);

function classify(error: PostgrestError): GraphWriteError {
  const code = error.code ?? '';
  const refused = REFUSAL_CODES.has(code) || /^23\d/.test(code);
  return new GraphWriteError(
    refused ? 'refused' : 'unavailable',
    `graph write ${refused ? 'refused' : 'unavailable'}: ${error.message}`,
    error
  );
}

/** The columns every replicated table orders and pages by. */
const CURSOR_COLUMN = 'updated_at';

export function createSupabaseGraphRowTransport(
  client: SupabaseClient<Database>
): GraphRowTransport {
  /**
   * A query builder for one replicated table, in whichever schema it lives.
   * The `kb` schema is not in the generated types, so its builders are
   * untyped here — the rows are validated by the replica's own column-driven
   * writer, and access by RLS.
   */
  function table(name: GraphSyncTableName) {
    const descriptor = describeTable(name);
    const scoped =
      descriptor.schema === 'public'
        ? client
        : (client as unknown as SupabaseClient).schema(descriptor.schema);
    return (scoped as unknown as SupabaseClient).from(descriptor.remote);
  }

  return {
    async pullSince(name, spaceId, since, limit, offset) {
      let query = table(name)
        .select('*')
        .eq('space_id', spaceId)
        // Id as tiebreaker: equal timestamps must order deterministically or
        // offset pages could overlap/skip between requests.
        .order(CURSOR_COLUMN, { ascending: true })
        .order('id', { ascending: true })
        // One extra row is the cheapest honest answer to "is there more?":
        // a full page is ambiguous on its own, and a count query would be a
        // second round-trip per page.
        .range(offset, offset + limit);
      if (since) query = query.gte(CURSOR_COLUMN, since.toISOString());
      const { data, error } = await query;
      if (error) throw classify(error);
      const rows = (data ?? []) as Record<string, unknown>[];
      const page: PullPage = {
        // The extra row only answers "is there more?" and is never applied,
        // so it is not checked either: the next page checks it.
        ...parseServerRows(name, rows.slice(0, limit)),
        hasMore: rows.length > limit,
      };
      return page;
    },

    async inventory(name, spaceId) {
      // Ids only: this is a sweep over everything the user can see, and
      // fetching whole rows to compare identity would make the periodic
      // check cost as much as a full re-pull.
      const { data, error } = await table(name)
        .select('id')
        .eq('space_id', spaceId);
      if (error) throw classify(error);
      return parseServerIds(
        name,
        ((data ?? []) as { id: unknown }[]).map((row) => row.id)
      );
    },

    async pullByNodes(name, spaceId, nodeIds) {
      const descriptor = describeTable(name);
      if (descriptor.nodeKey === null) return { rows: [], refused: [] };
      let query = table(name).select('*').eq('space_id', spaceId);
      query = descriptor.nodeKeySecondary
        ? query.or(
            `${descriptor.nodeKey}.in.(${nodeIds.join(',')}),` +
              `${descriptor.nodeKeySecondary}.in.(${nodeIds.join(',')})`
          )
        : query.in(descriptor.nodeKey, nodeIds);
      const { data, error } = await query;
      if (error) throw classify(error);
      return parseServerRows(name, (data ?? []) as Record<string, unknown>[]);
    },

    async write(write) {
      if (write.kind === 'rpc') {
        const { error } = await (client as unknown as SupabaseClient).rpc(
          write.fn,
          write.args
        );
        if (error) throw classify(error);
        return;
      }
      const builder = table(write.table);
      if (write.kind === 'upsert') {
        const { error } = await builder.upsert(write.row, {
          onConflict: write.onConflict,
          ignoreDuplicates: write.ignoreDuplicates ?? false,
        });
        if (error) throw classify(error);
        return;
      }
      if (write.kind === 'patch') {
        // `select('id')` turns a silent zero-row UPDATE into a verdict: a row
        // this session cannot see (or that is gone) is a refusal, the same
        // way the deployed RLS reads it — not a success that drains the
        // journal while the server holds something else.
        const { data, error } = await matchAll(
          builder.update(write.values),
          write.match
        ).select('id');
        if (error) throw classify(error);
        if (!data || data.length === 0) {
          throw new GraphWriteError(
            'refused',
            'graph write refused: patch matched no visible row'
          );
        }
        return;
      }
      const { error } = await matchAll(builder.delete(), write.match);
      if (error) throw classify(error);
    },

    subscribe(spaceId, handlers) {
      // The payload is deliberately ignored except for its event type: a
      // nudge is not a delivery. What a DELETE tells us is only that a sweep
      // is worth running now instead of at the next interval.
      let channel: RealtimeChannel | null = client
        .channel(`graph-sync:${spaceId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'knowledge_resources',
            filter: `space_id=eq.${spaceId}`,
          },
          (payload) => {
            if (payload.eventType === 'DELETE') handlers.onDelete();
            else handlers.onChange();
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'knowledge_edges',
            filter: `space_id=eq.${spaceId}`,
          },
          (payload) => {
            if (payload.eventType === 'DELETE') handlers.onDelete();
            else handlers.onChange();
          }
        )
        // SUBSCRIBED is the only state in which nudges arrive; an error, a
        // timeout or a close all mean they cannot.
        .subscribe((status) => handlers.onStatus?.(status === 'SUBSCRIBED'));
      return () => {
        if (channel) void client.removeChannel(channel);
        channel = null;
      };
    },
  };
}

type Matchable = { eq: (column: string, value: unknown) => Matchable };

function matchAll<T extends Matchable>(
  builder: T,
  match: Record<string, unknown>
): T {
  let query = builder;
  for (const [column, value] of Object.entries(match)) {
    query = query.eq(column, value) as T;
  }
  return query;
}
