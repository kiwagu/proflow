import { connect } from '@nats-io/transport-deno';
import { jetstream, jetstreamManager } from '@nats-io/jetstream';

import type { SpaceOrgLifecycleEnvelope } from '@workspace/domain-events';
import {
  SPACE_ORG_LIFECYCLE_STREAM_NAME,
  spaceOrgLifecycleJetStreamSubject,
} from '@workspace/domain-events';
import { createLogger, logRequestTrace } from '@workspace/logger';

const textEncoder = new TextEncoder();
const log = createLogger({ name: 'space_org_nats' });

async function ensureSpaceOrgStream(
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
      subjects: ['space_org.lifecycle.v1.>'],
    });
  }
}

export async function publishSpaceOrgLifecycleToJetStream(
  payload: SpaceOrgLifecycleEnvelope
): Promise<void> {
  const url = Deno.env.get('NATS_URL')?.trim();
  if (!url) {
    throw new Error('NATS_URL is not set');
  }
  const streamName =
    Deno.env.get('SPACE_ORG_NATS_STREAM')?.trim() ||
    SPACE_ORG_LIFECYCLE_STREAM_NAME;
  logRequestTrace(log, 'nats connect start');
  const nc = await connect({ servers: url });
  try {
    await ensureSpaceOrgStream(nc, streamName);
    const js = jetstream(nc);
    const subject = spaceOrgLifecycleJetStreamSubject(payload.event);
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
