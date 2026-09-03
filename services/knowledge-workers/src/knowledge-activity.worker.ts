/**
 * JetStream consumer for knowledge-activity body edits (authoring body edit ->
 * Postgres activity-log spine). The producer PUBLISHES a body-edit event onto
 * `knowledge.activity.v1.>`; this durable consumer APPENDS the matching
 * `kb.resource_activity` row (source=`nats-body`), and the DB roll-up trigger
 * advances `knowledge_resources.last_activity_at`.
 *
 * Local dev: `bun run dev` in `services/knowledge-workers` starts both workers
 * (concurrently). For this worker only: `bun run start:knowledge-activity`.
 *
 * Env (loaded via bun --env-file=.env):
 *   - NATS_URL                          (required)
 *   - SUPABASE_URL                      (required; the service-role append target)
 *   - SUPABASE_SERVICE_ROLE_KEY         (required; the trusted background ingest channel)
 *   - KNOWLEDGE_ACTIVITY_NATS_STREAM    (optional; default KNOWLEDGE_ACTIVITY)
 *   - KNOWLEDGE_ACTIVITY_NATS_CONSUMER  (optional; default author-activity-v1)
 *
 * Trust model (authorize-at-produce): the worker holds no user JWT,
 * so it appends via SERVICE-ROLE. This is a NARROW carve-out from "never
 * service-role on a user path" — the body edit was ALREADY authorized at produce
 * time (the producer admitted the body write only after the caller's RLS passed
 * on `node_id`), and the row is derived audit metadata, not user content. All
 * READS of the log stay under the user's RLS.
 *
 * Idempotency: JetStream is at-least-once. The append carries the message's
 * `Nats-Msg-Id` as `event_id`; the partial-unique `kb_resource_activity_event_id_key`
 * drops duplicates. We use an UPSERT on `event_id` with `ignoreDuplicates`, so a
 * re-delivery is a clean no-op; combined with `greatest()` in the roll-up, replay
 * and out-of-order can never regress recency. We ACK on a successful append OR a
 * known duplicate, `term()` an invalid envelope (poison), `nak()` a transient error.
 *
 * Runtime: bun, like the other services here (this worker never imported the
 * authoring app's config, so the constraint that forced its former host onto
 * tsx/Node does not apply).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@workspace/db';
import { kbSchema } from '@workspace/db/kb-schema';
import {
  KNOWLEDGE_ACTIVITY_CONSUMER_NAME,
  KNOWLEDGE_ACTIVITY_STREAM_NAME,
  KNOWLEDGE_ACTIVITY_SUBJECT_FILTER,
  parseKnowledgeActivityBodyEvent,
} from '@workspace/knowledge-contracts';
import {
  AckPolicy,
  DeliverPolicy,
  jetstream,
  jetstreamManager,
} from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';

import {
  createServiceRoleSupabaseClient,
  isServiceRoleSupabaseConfigured,
} from './supabase.js';

const streamName =
  process.env.KNOWLEDGE_ACTIVITY_NATS_STREAM?.trim() ||
  KNOWLEDGE_ACTIVITY_STREAM_NAME;
const consumerName =
  process.env.KNOWLEDGE_ACTIVITY_NATS_CONSUMER?.trim() ||
  KNOWLEDGE_ACTIVITY_CONSUMER_NAME;

/** A body edit is NODE activity, not a per-user open — descriptor, not a name. */
const BODY_EDIT_KIND = 'body_edit' as const;

function serviceSupabaseClient(): SupabaseClient<Database> | null {
  if (!isServiceRoleSupabaseConfigured()) {
    return null;
  }
  return createServiceRoleSupabaseClient();
}

async function ensureStream(
  jsm: Awaited<ReturnType<typeof jetstreamManager>>
): Promise<void> {
  try {
    await jsm.streams.info(streamName);
  } catch {
    await jsm.streams.add({
      name: streamName,
      subjects: [KNOWLEDGE_ACTIVITY_SUBJECT_FILTER],
    });
  }
}

async function ensureConsumer(
  jsm: Awaited<ReturnType<typeof jetstreamManager>>
): Promise<void> {
  try {
    await jsm.consumers.info(streamName, consumerName);
  } catch {
    await jsm.consumers.add(streamName, {
      durable_name: consumerName,
      filter_subject: KNOWLEDGE_ACTIVITY_SUBJECT_FILTER,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
    });
  }
}

async function main(): Promise<void> {
  const natsUrl = process.env.NATS_URL?.trim();
  if (!natsUrl) {
    console.error('knowledge-activity.worker: NATS_URL is not set');
    process.exit(1);
  }
  const supabase = serviceSupabaseClient();
  if (!supabase) {
    console.error(
      'knowledge-activity.worker: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing'
    );
    process.exit(1);
  }

  const nc = await connect({ servers: natsUrl });
  const jsm = await jetstreamManager(nc);
  await ensureStream(jsm);
  await ensureConsumer(jsm);

  const js = jetstream(nc);
  const consumer = await js.consumers.get(streamName, consumerName);
  const messages = await consumer.consume();

  console.log(
    `knowledge-activity.worker: consuming stream=${streamName} consumer=${consumerName}`
  );

  const shutdown = async () => {
    console.log('knowledge-activity.worker: shutting down');
    await messages.close();
    await nc.drain();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });

  for await (const m of messages) {
    try {
      const text = new TextDecoder().decode(m.data);
      let json: unknown;
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        console.error(
          'knowledge-activity.worker: invalid JSON',
          text.slice(0, 200)
        );
        m.term();
        continue;
      }
      const parsed = parseKnowledgeActivityBodyEvent(json);
      if (!parsed.success) {
        console.error(
          'knowledge-activity.worker: envelope validation failed',
          parsed.error.issues
        );
        m.term();
        continue;
      }
      const event = parsed.data;
      // Dedupe key: prefer the broker's Nats-Msg-Id (the producer set it to
      // event_id), fall back to the envelope event_id. Either yields an idempotent
      // append against the partial-unique on event_id.
      const eventId = m.headers?.get('Nats-Msg-Id') || event.event_id;

      // Idempotent service-role append (authorize-at-produce, §0.3). UPSERT on
      // event_id with ignoreDuplicates → a re-delivery is a clean no-op. The
      // roll-up trigger advances last_activity_at via greatest().
      const { error } = await kbSchema(supabase)
        .from('resource_activity')
        .upsert(
          {
            space_id: event.space_id,
            resource_id: event.node_id,
            user_id: null,
            kind: BODY_EDIT_KIND,
            source: 'nats-body',
            event_id: eventId,
            occurred_at: event.occurred_at,
          },
          { onConflict: 'event_id', ignoreDuplicates: true }
        );
      if (error) {
        console.error(
          'knowledge-activity.worker: append failed',
          error.message
        );
        m.nak();
        continue;
      }
      m.ack();
    } catch (e) {
      console.error('knowledge-activity.worker: message error', e);
      m.nak();
    }
  }
}

main().catch((e) => {
  console.error('knowledge-activity.worker: fatal', e);
  process.exit(1);
});
