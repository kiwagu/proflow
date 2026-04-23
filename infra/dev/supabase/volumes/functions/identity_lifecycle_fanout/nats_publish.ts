import { connect } from '@nats-io/transport-deno';
import { jetstream, jetstreamManager } from '@nats-io/jetstream';

import type { IdentityLifecycleEnvelope } from '@workspace/domain-events';
import {
  IDENTITY_LIFECYCLE_STREAM_NAME,
  identityLifecycleJetStreamSubject,
} from '@workspace/domain-events';
import { createLogger, logRequestTrace } from '@workspace/logger';

const textEncoder = new TextEncoder();
const log = createLogger({ name: 'identity_nats' });

async function ensureIdentityStream(
  nc: Awaited<ReturnType<typeof connect>>,
  streamName: string
): Promise<void> {
  const jsm = await jetstreamManager(nc);
  try {
    await jsm.streams.info(streamName);
    logRequestTrace(log, 'jetstream stream exists', { streamName });
  } catch {
    logRequestTrace(log, 'jetstream stream create', { streamName });
    await jsm.streams.add({
      name: streamName,
      subjects: ['identity.lifecycle.v1.>'],
    });
  }
}

export async function publishIdentityLifecycleToJetStream(
  payload: IdentityLifecycleEnvelope
): Promise<void> {
  const url = Deno.env.get('NATS_URL')?.trim();
  if (!url) {
    throw new Error('NATS_URL is not set');
  }
  const streamName =
    Deno.env.get('IDENTITY_NATS_STREAM')?.trim() || IDENTITY_LIFECYCLE_STREAM_NAME;
  logRequestTrace(log, 'nats connect start');
  const nc = await connect({ servers: url });
  try {
    await ensureIdentityStream(nc, streamName);
    const js = jetstream(nc);
    const subject = identityLifecycleJetStreamSubject(payload.event);
    const data = textEncoder.encode(JSON.stringify(payload));
    logRequestTrace(log, 'jetstream publish', { subject });
    await js.publish(subject, data);
    logRequestTrace(log, 'jetstream publish ack', { subject });
  } finally {
    logRequestTrace(log, 'nats drain start');
    await nc.drain();
    logRequestTrace(log, 'nats drain done');
  }
}
