import {
  KNOWLEDGE_ACTIVITY_BODY_SUBJECT,
  KNOWLEDGE_ACTIVITY_STREAM_NAME,
  KNOWLEDGE_ACTIVITY_SUBJECT_FILTER,
  knowledgeActivityBodyEventSchema,
  type KnowledgeActivityBodyEvent,
} from '@workspace/knowledge-contracts';
import {
  jetstream,
  jetstreamManager,
  type JetStreamClient,
} from '@nats-io/jetstream';
import { connect, type NatsConnection } from '@nats-io/transport-node';

/**
 * Knowledge-activity PRODUCER — the publish seam used by the
 * Payload `Bodies.afterChange` hook to emit a body-edit activity event onto the
 * `knowledge.activity.v1.>` JetStream. It does NOT write Postgres — the durable
 * consumer in `services/knowledge-workers` owns the `kb.resource_activity`
 * append (service-role, authorize-at-produce, §0.3). The hook stays best-effort:
 * `publishBodyActivity` NEVER throws on the user's save path; a publish hiccup
 * self-heals on the next body touch (and the at-least-once consumer covers a
 * retried delivery).
 *
 * The connection is created lazily and cached for the process lifetime (the Next
 * server runtime), mirroring how the workers hold one long-lived connection. The
 * stream is ensured on first publish so a fresh dev broker has the stream the
 * consumer also (idempotently) ensures.
 *
 * Env: `NATS_URL` (same convention as the identity worker). `KNOWLEDGE_ACTIVITY_NATS_STREAM`
 * optionally overrides the stream name (default `KNOWLEDGE_ACTIVITY`).
 */

const streamName =
  process.env.KNOWLEDGE_ACTIVITY_NATS_STREAM?.trim() ||
  KNOWLEDGE_ACTIVITY_STREAM_NAME;

type Conn = { nc: NatsConnection; js: JetStreamClient };

let connPromise: Promise<Conn | null> | null = null;

async function ensureStream(nc: NatsConnection): Promise<void> {
  const jsm = await jetstreamManager(nc);
  try {
    await jsm.streams.info(streamName);
  } catch {
    await jsm.streams.add({
      name: streamName,
      subjects: [KNOWLEDGE_ACTIVITY_SUBJECT_FILTER],
    });
  }
}

async function getConnection(): Promise<Conn | null> {
  const natsUrl = process.env.NATS_URL?.trim();
  if (!natsUrl) {
    return null;
  }
  if (!connPromise) {
    connPromise = (async () => {
      const nc = await connect({ servers: natsUrl });
      await ensureStream(nc);
      return { nc, js: jetstream(nc) };
    })().catch((error) => {
      // Reset so a later publish can retry the connection (best-effort).
      connPromise = null;
      throw error;
    });
  }
  return connPromise;
}

/**
 * Publish a body-edit activity event. Validates the envelope, sets the JetStream
 * `Nats-Msg-Id` to `event_id` (broker-side dedupe), and returns whether the
 * publish landed. NEVER throws — a `false` return means "not published, self-heals
 * next touch"; the caller logs and continues the user's save.
 */
export async function publishBodyActivity(
  event: KnowledgeActivityBodyEvent
): Promise<boolean> {
  const parsed = knowledgeActivityBodyEventSchema.safeParse(event);
  if (!parsed.success) {
    console.error(
      'knowledge-activity.publisher: invalid envelope',
      parsed.error.issues
    );
    return false;
  }
  try {
    const conn = await getConnection();
    if (!conn) {
      console.warn(
        'knowledge-activity.publisher: NATS_URL not set; skipping publish'
      );
      return false;
    }
    const payload = new TextEncoder().encode(JSON.stringify(parsed.data));
    await conn.js.publish(KNOWLEDGE_ACTIVITY_BODY_SUBJECT, payload, {
      msgID: parsed.data.event_id,
    });
    return true;
  } catch (error) {
    console.error('knowledge-activity.publisher: publish failed', error);
    return false;
  }
}
