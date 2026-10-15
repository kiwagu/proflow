import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@workspace/db';
import type { SpaceId } from '@workspace/entity-id';
import { z } from 'zod';

/**
 * The channels the leader of a browser listens on, and the one place that
 * knows they are Supabase Realtime. Everything else in the composition sees
 * the `SyncChannels` seam: join a topic, hear what it says, leave.
 *
 * A space topic carries no content. The database signals on it that
 * something of a kind changed in the space, at most once per throttle
 * window, and that the topic moved to a new epoch; joining it is decided by
 * the row policies of the server, never here. What arrives is read through
 * the schemas below and dropped when it does not fit: a signal is only ever
 * a reason to pull, so one lost costs latency, never data.
 */

/** `space:<space id>:<epoch>`, the topic a space's signals go to. */
export function spaceTopic(spaceId: SpaceId, epoch: number): string {
  return `space:${spaceId}:${epoch}`;
}

/**
 * "Something of this kind changed in the space", with the throttle window
 * the server is signaling at. The server may add fields of its own; they
 * are not read.
 */
export const spaceSignalSchema = z
  .object({
    kind: z.enum(['graph', 'graph-delete', 'documents']),
    window_ms: z.number().int().positive(),
  })
  .transform(({ kind, window_ms }) => ({ kind, windowMs: window_ms }));
export type SpaceSignal = z.infer<typeof spaceSignalSchema>;
export type SpaceSignalKind = SpaceSignal['kind'];

/** The topic moved: the space's signals now go to this epoch's topic. */
export const spaceRekeySchema = z.object({
  epoch: z.number().int().nonnegative(),
});
export type SpaceRekey = z.infer<typeof spaceRekeySchema>;

/**
 * Why a channel is not delivering: the join was refused by the server's
 * policy (`refused` — not a member, or a stale epoch), the connection failed
 * (`error`), the join got no answer (`timeout`), or the channel was closed.
 */
export type ChannelDownReason = 'error' | 'closed' | 'timeout' | 'refused';

export interface SpaceChannelHandlers {
  onSignal(signal: SpaceSignal): void;
  onRekey(next: SpaceRekey): void;
  /** Joined: signals reach this channel from now on (give or take seconds). */
  onSubscribed(): void;
  onDown(reason: ChannelDownReason): void;
}

export interface SyncChannels {
  /**
   * Join a space topic. Returns the leave function; once it is called,
   * nothing more is heard from that join.
   */
  joinSpace(topic: string, handlers: SpaceChannelHandlers): () => void;
}

/** What Realtime answers a join its read policy turns down with. */
const REFUSED = /unauthori[sz]ed|permission/i;

export function createRealtimeSyncChannels(
  client: SupabaseClient<Database>
): SyncChannels {
  return {
    joinSpace(topic, handlers) {
      let live = true;
      const channel: RealtimeChannel = client
        .channel(topic, { config: { private: true } })
        .on('broadcast', { event: 'changed' }, ({ payload }) => {
          if (!live) return;
          const signal = spaceSignalSchema.safeParse(payload);
          if (signal.success) handlers.onSignal(signal.data);
        })
        .on('broadcast', { event: 'rekey' }, ({ payload }) => {
          if (!live) return;
          const rekey = spaceRekeySchema.safeParse(payload);
          if (rekey.success) handlers.onRekey(rekey.data);
        })
        .subscribe((status, error) => {
          if (!live) return;
          if (status === 'SUBSCRIBED') handlers.onSubscribed();
          else if (status === 'CHANNEL_ERROR')
            handlers.onDown(
              error && REFUSED.test(error.message) ? 'refused' : 'error'
            );
          else if (status === 'TIMED_OUT') handlers.onDown('timeout');
          else handlers.onDown('closed');
        });
      return () => {
        if (!live) return;
        live = false;
        void client.removeChannel(channel);
      };
    },
  };
}
