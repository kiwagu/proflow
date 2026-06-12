/**
 * JetStream consumer for space/org lifecycle (Postgres -> Author Payload mirror).
 * Run with `bun run space-org:jetstream` or alongside `bun run dev`.
 *
 * Runtime: executed under tsx (Node), not the Bun runtime. Importing @payload-config
 * pulls @lexical/react, which trips an upstream Bun ESM circular-import bug
 * (oven-sh/bun#17056, still open in 1.4 canary) and crashes with
 * "Cannot access 'DecoratorNode' before initialization". Node evaluates the cycle
 * correctly. `bun run …:jetstream` still works — bun only acts as the script runner.
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
  SPACE_ORG_LIFECYCLE_STREAM_NAME,
  parseSpaceOrgLifecycleEnvelope,
} from '@workspace/domain-events';
import config from '@payload-config';
import { getPayload } from 'payload';

import { applySpaceOrgLifecycleEvent } from '@/identity/space-org.lifecycle.apply';

const streamName =
  process.env.SPACE_ORG_NATS_STREAM?.trim() || SPACE_ORG_LIFECYCLE_STREAM_NAME;
const consumerName =
  process.env.SPACE_ORG_NATS_CONSUMER?.trim() || 'author-space-org-v1';

async function ensureStream(
  jsm: Awaited<ReturnType<typeof jetstreamManager>>
): Promise<void> {
  try {
    await jsm.streams.info(streamName);
  } catch {
    await jsm.streams.add({
      name: streamName,
      subjects: ['space_org.lifecycle.v1.>'],
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
      filter_subject: 'space_org.lifecycle.v1.>',
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
    });
  }
}

async function main(): Promise<void> {
  const natsUrl = process.env.NATS_URL?.trim();
  if (!natsUrl) {
    console.error('space-org.jetstream.worker: NATS_URL is not set');
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
    `space-org.jetstream.worker: consuming stream=${streamName} consumer=${consumerName}`
  );

  const shutdown = async () => {
    console.log('space-org.jetstream.worker: shutting down');
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
          'space-org.jetstream.worker: invalid JSON',
          text.slice(0, 200)
        );
        m.term();
        continue;
      }
      const parsed = parseSpaceOrgLifecycleEnvelope(json);
      if (!parsed.success) {
        console.error(
          'space-org.jetstream.worker: envelope validation failed',
          parsed.error
        );
        m.term();
        continue;
      }
      const payload = await getPayload({ config });
      const result = await applySpaceOrgLifecycleEvent(payload, parsed.data);
      if (!result.ok) {
        if (result.status === 409) {
          console.warn(
            'space-org.jetstream.worker: apply inconsistent',
            result.message
          );
        } else {
          console.error(
            'space-org.jetstream.worker: apply failed',
            result.message
          );
        }
        m.nak();
        continue;
      }
      m.ack();
    } catch (e) {
      console.error('space-org.jetstream.worker: message error', e);
      m.nak();
    }
  }
}

main().catch((e) => {
  console.error('space-org.jetstream.worker: fatal', e);
  process.exit(1);
});
