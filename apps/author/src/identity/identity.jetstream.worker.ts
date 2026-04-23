/**
 * JetStream consumer for identity lifecycle (Supabase -> Author Payload mirror).
 * Local dev: `bun run dev` in `apps/author` starts Next and this worker (concurrently). For worker only: `bun run identity:jetstream`.
 *
 * Requires NATS_URL, PAYLOAD_SECRET, MONGO_URL (and Payload env). Set IDENTITY_NATS_STREAM / IDENTITY_NATS_CONSUMER if needed.
 */
import 'dotenv/config';

import {
  AckPolicy,
  DeliverPolicy,
  jetstream,
  jetstreamManager,
} from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';
import {
  IDENTITY_LIFECYCLE_STREAM_NAME,
  parseIdentityLifecycleEnvelope,
} from '@workspace/domain-events';
import config from '@payload-config';
import { getPayload } from 'payload';

import { applyIdentityLifecycleEvent } from '@/identity/identity.lifecycle.apply';
import { shouldApplyIdentityLifecycleToAuthorShell } from '@/identity/identity.service-routing.stub';

const streamName =
  process.env.IDENTITY_NATS_STREAM?.trim() || IDENTITY_LIFECYCLE_STREAM_NAME;
const consumerName =
  process.env.IDENTITY_NATS_CONSUMER?.trim() || 'author-identity-v1';

async function ensureStream(
  jsm: Awaited<ReturnType<typeof jetstreamManager>>
): Promise<void> {
  try {
    await jsm.streams.info(streamName);
  } catch {
    await jsm.streams.add({
      name: streamName,
      subjects: ['identity.lifecycle.v1.>'],
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
      filter_subject: 'identity.lifecycle.v1.>',
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
    });
  }
}

async function main(): Promise<void> {
  const natsUrl = process.env.NATS_URL?.trim();
  if (!natsUrl) {
    console.error('identity.jetstream.worker: NATS_URL is not set');
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
    `identity.jetstream.worker: consuming stream=${streamName} consumer=${consumerName}`
  );

  const shutdown = async () => {
    console.log('identity.jetstream.worker: shutting down');
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
          'identity.jetstream.worker: invalid JSON',
          text.slice(0, 200)
        );
        m.term();
        continue;
      }
      const parsed = parseIdentityLifecycleEnvelope(json);
      if (!parsed.success) {
        console.error(
          'identity.jetstream.worker: envelope validation failed',
          parsed.error
        );
        m.term();
        continue;
      }
      const body = parsed.data;
      if (!shouldApplyIdentityLifecycleToAuthorShell(body)) {
        m.ack();
        continue;
      }
      const payload = await getPayload({ config });
      const result = await applyIdentityLifecycleEvent(payload, body);
      if (!result.ok) {
        console.error(
          'identity.jetstream.worker: apply failed',
          result.message
        );
        m.nak();
        continue;
      }
      m.ack();
    } catch (e) {
      console.error('identity.jetstream.worker: message error', e);
      m.nak();
    }
  }
}

main().catch((e) => {
  console.error('identity.jetstream.worker: fatal', e);
  process.exit(1);
});
