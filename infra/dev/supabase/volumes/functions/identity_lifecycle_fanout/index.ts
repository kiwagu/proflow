import { Webhook } from 'npm:standardwebhooks@1.0.0';

import {
  parseIdentityLifecycleEnvelope,
  parseIdentityLifecycleInternalIngest,
  toIdentityLifecycleEnvelope,
  type IdentityLifecycleEnvelope,
} from '@workspace/domain-events';
import { createLogger, withLogContext } from '@workspace/logger';
import { headerRecord } from '../_shared/headerRecord.ts';
import { parseWhsecSecret } from '../_shared/parseWhsecSecret.ts';
import { publishIdentityLifecycleToJetStream } from './nats_publish.ts';

const log = createLogger({ name: 'identity_fanout' });

async function publishValidated(payload: IdentityLifecycleEnvelope): Promise<void> {
  const checked = parseIdentityLifecycleEnvelope(payload);
  if (!checked.success) {
    log.error({ issues: checked.error.issues }, 'envelope validation failed');
    throw new Error('Invalid identity lifecycle envelope');
  }
  await publishIdentityLifecycleToJetStream(checked.data);
}

function mapGotrueHookToEvent(
  hookName: string | undefined
): { event: 'user.created'; source: string } | null {
  if (hookName === 'after-user-created' || hookName === 'before-user-created') {
    return { event: 'user.created', source: hookName };
  }
  return null;
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
    log.debug(
      {
        bytes: rawBody.length,
        internalIngest: Boolean(internalSecret && req.headers.get('x-identity-internal-secret')),
      },
      'body read'
    );

    let canonical: IdentityLifecycleEnvelope | null = null;

    const incomingInternal = req.headers.get('x-identity-internal-secret');
    if (internalSecret && incomingInternal) {
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
      const internal = parseIdentityLifecycleInternalIngest(parsed);
      if (!internal.success) {
        return new Response(JSON.stringify({ error: 'Invalid internal payload' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      canonical = toIdentityLifecycleEnvelope(internal.data, 'internal-ingest');
    } else {
      const secretRaw = Deno.env.get('IDENTITY_LIFECYCLE_HOOK_SECRETS');
      if (!secretRaw) {
        log.error('IDENTITY_LIFECYCLE_HOOK_SECRETS is not set');
        return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      let wh: Webhook;
      try {
        wh = new Webhook(parseWhsecSecret(secretRaw));
      } catch (e) {
        log.error({ err: e }, 'webhook secret config invalid');
        return new Response(JSON.stringify({ error: 'Invalid webhook secret config' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      try {
        wh.verify(rawBody, headerRecord(req));
      } catch (e) {
        log.error({ detail: String(e) }, 'webhook verification failed');
        return new Response(JSON.stringify({ error: 'Invalid signature' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      let payload: {
        metadata?: { name?: string };
        user?: {
          id?: string;
          email?: string | null;
          app_metadata?: Record<string, unknown>;
          user_metadata?: Record<string, unknown>;
        };
      };
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const hookName = payload.metadata?.name;
      const mapped = mapGotrueHookToEvent(hookName);
      const uid = payload.user?.id;
      if (!mapped || !uid) {
        return new Response(JSON.stringify({ error: 'Unsupported hook or missing user.id' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      /**
       * GoTrue webhook is *not* the canonical source for identity lifecycle fan-out in this repo.
       *
       * Reason: canonical `user.created` must include `profiles.entity_id`, which is minted in
       * Postgres on `public.profiles` insert. The GoTrue hook fires on `auth.users` creation and
       * cannot guarantee `profiles` is created/backfilled at this moment.
       *
       * Canonical fan-out is emitted from Postgres triggers (internal ingest) once `profiles`
       * exists, so we only validate & acknowledge this webhook to keep GoTrue happy.
       */
      log.info(
        { hookName: mapped.source, userId: uid },
        'gotrue webhook accepted (no jetstream publish; canonical event comes from profiles)'
      );
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!canonical) {
      return new Response(JSON.stringify({ error: 'Unsupported request' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      log.info(
        { event: canonical.event, userId: canonical.user.id },
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

    log.info('response 200');
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
});
