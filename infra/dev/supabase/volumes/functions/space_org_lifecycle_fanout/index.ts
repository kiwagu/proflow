import {
  parseSpaceOrgLifecycleEnvelope,
  parseSpaceOrgLifecycleInternalIngest,
  toSpaceOrgLifecycleEnvelope,
  type SpaceOrgLifecycleEnvelope,
} from '@workspace/domain-events';
import { createLogger, withLogContext } from '@workspace/logger';

import { publishSpaceOrgLifecycleToJetStream } from './nats_publish.ts';

const log = createLogger({ name: 'space_org_fanout' });

async function publishValidated(payload: SpaceOrgLifecycleEnvelope): Promise<void> {
  const checked = parseSpaceOrgLifecycleEnvelope(payload);
  if (!checked.success) {
    log.error({ issues: checked.error.issues }, 'envelope validation failed');
    throw new Error('Invalid space/org lifecycle envelope');
  }
  await publishSpaceOrgLifecycleToJetStream(checked.data);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const requestId = crypto.randomUUID().slice(0, 8);

  return withLogContext({ requestId }, async () => {
    log.info('request accepted');

    const internalSecret = Deno.env.get('IDENTITY_INTERNAL_INGEST_SECRET') ?? '';
    const rawBody = await req.text();

    const incomingInternal = req.headers.get('x-identity-internal-secret');
    if (!internalSecret || !incomingInternal) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (incomingInternal !== internalSecret) {
      return new Response(JSON.stringify({ error: 'Invalid internal secret' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const internal = parseSpaceOrgLifecycleInternalIngest(parsed);
    if (!internal.success) {
      return new Response(JSON.stringify({ error: 'Invalid internal payload' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const canonical = toSpaceOrgLifecycleEnvelope(internal.data, 'internal-ingest');

    try {
      log.info(
        { event: canonical.event },
        'jetstream publish start'
      );
      await publishValidated(canonical);
    } catch (e) {
      log.error({ detail: String(e) }, 'JetStream publish failed');
      return new Response(JSON.stringify({ error: 'JetStream publish failed' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
});
