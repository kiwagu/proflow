import { randomUUID } from 'node:crypto';

import {
  gotruePayloadToEmailTemplate,
  initializeMessages,
  localeFromGoTrueUser,
  type EmailNotificationInput,
  type GoTrueSendEmailHookPayload,
} from '@workspace/notifications';
import { PLATFORM_LOCALES } from '@workspace/settings-runtime';

import {
  drainNotificationsOutboxOnce,
  enqueueNotificationRequest,
  getNotificationsOutboxMetrics,
  startNotificationsOutboxWorker,
} from './outbox-worker.js';

await initializeMessages([...PLATFORM_LOCALES]);

startNotificationsOutboxWorker();

const INTERNAL_TOKEN = process.env.NOTIFICATIONS_INTERNAL_TOKEN;

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

function badRequest(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

function serverError(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}

function accepted(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 202,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isEmailNotificationInput(v: unknown): v is EmailNotificationInput {
  if (v === null || typeof v !== 'object') {
    return false;
  }
  const o = v as Record<string, unknown>;
  return (
    o.channel === 'email' &&
    typeof o.to === 'string' &&
    typeof o.locale === 'string' &&
    o.template !== null &&
    typeof o.template === 'object'
  );
}

function isGoTrueSendEmailHookPayload(
  v: unknown
): v is GoTrueSendEmailHookPayload {
  if (v === null || typeof v !== 'object') {
    return false;
  }
  const o = v as Record<string, unknown>;
  const user = o.user;
  const emailData = o.email_data;
  if (user === null || typeof user !== 'object') {
    return false;
  }
  if (emailData === null || typeof emailData !== 'object') {
    return false;
  }
  const userObj = user as Record<string, unknown>;
  const emailDataObj = emailData as Record<string, unknown>;
  const userEmail = userObj.email;
  return (
    typeof userObj.id === 'string' &&
    (userEmail === undefined || typeof userEmail === 'string') &&
    typeof emailDataObj.token_hash === 'string' &&
    typeof emailDataObj.redirect_to === 'string' &&
    typeof emailDataObj.email_action_type === 'string' &&
    typeof emailDataObj.site_url === 'string'
  );
}

function requireInternalToken(req: Request): Response | null {
  if (!INTERNAL_TOKEN) {
    return serverError('NOTIFICATIONS_INTERNAL_TOKEN is not configured');
  }

  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${INTERNAL_TOKEN}`) {
    return unauthorized();
  }

  return null;
}

function parsePositiveInteger(
  value: string | null,
  fieldName: string
): number | Response | undefined {
  if (value === null) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return badRequest(`${fieldName} must be a positive integer`);
  }

  return parsed;
}

function directEmailIdempotencyKey(req: Request): string {
  const raw = req.headers.get('Idempotency-Key')?.trim();
  if (raw && raw.length > 0) {
    return `notify:direct-email:${raw}`;
  }

  return `notify:direct-email:${randomUUID()}`;
}

const port = Number(process.env.PORT ?? '3010');

Bun.serve({
  port,
  hostname: process.env.HOST ?? '0.0.0.0',
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === 'GET' && url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'GET' && url.pathname === '/v1/outbox/metrics') {
      const authError = requireInternalToken(req);
      if (authError) {
        return authError;
      }

      const failedSinceHours = parsePositiveInteger(
        url.searchParams.get('failedSinceHours'),
        'failedSinceHours'
      );
      if (failedSinceHours instanceof Response) {
        return failedSinceHours;
      }

      const processingStaleAfterSeconds = parsePositiveInteger(
        url.searchParams.get('processingStaleAfterSeconds'),
        'processingStaleAfterSeconds'
      );
      if (processingStaleAfterSeconds instanceof Response) {
        return processingStaleAfterSeconds;
      }

      try {
        const metrics = await getNotificationsOutboxMetrics({
          failedSinceHours,
          processingStaleAfterSeconds,
        });

        return new Response(JSON.stringify({ ok: true, metrics }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Metrics failed';
        return serverError(message);
      }
    }

    if (req.method === 'POST' && url.pathname === '/v1/notifications/email') {
      const authError = requireInternalToken(req);
      if (authError) {
        return authError;
      }

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return badRequest('Invalid JSON body');
      }

      if (!isEmailNotificationInput(body)) {
        return badRequest('Body must be an email notification request');
      }

      try {
        const job = await enqueueNotificationRequest(body, {
          aggregateType: 'notification_request',
          aggregateId: randomUUID(),
          eventName: 'notification.email_requested',
          idempotencyKey: directEmailIdempotencyKey(req),
          context: {
            source: 'notifications_api',
          },
        });

        void drainNotificationsOutboxOnce().catch((drainError) => {
          console.error(
            'notifications-service: direct email outbox drain failed',
            drainError
          );
        });

        return accepted({
          ok: true,
          queued: true,
          jobId: job.jobId,
          idempotencyKey: job.idempotencyKey,
          status: job.status,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Send failed';
        return serverError(message);
      }
    }

    if (
      req.method === 'POST' &&
      url.pathname === '/v1/hooks/gotrue/send-email'
    ) {
      const authError = requireInternalToken(req);
      if (authError) {
        return authError;
      }

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return badRequest('Invalid JSON body');
      }

      if (!isGoTrueSendEmailHookPayload(body)) {
        return badRequest('Body must be a GoTrue send_email hook payload');
      }

      const confirmPath =
        process.env.AUTH_EMAIL_CONFIRM_PATH ?? '/auth/confirm';

      try {
        const to = body.user.email;
        if (!to) {
          return badRequest('GoTrue hook payload missing user.email');
        }

        const locale = localeFromGoTrueUser(body.user);
        const template = gotruePayloadToEmailTemplate(body, confirmPath);
        await enqueueNotificationRequest(
          {
            channel: 'email',
            to,
            locale,
            template,
          },
          {
            aggregateType: 'auth_user',
            aggregateId: body.user.id,
            eventName: 'auth.email_requested',
            idempotencyKey: `gotrue:send-email:${body.user.id}:${body.email_data.email_action_type}:${body.email_data.token_hash}`,
            context: {
              authUserId: body.user.id,
              actionType: body.email_data.email_action_type,
            },
          }
        );

        void drainNotificationsOutboxOnce().catch((drainError) => {
          console.error(
            'notifications-service: gotrue outbox drain failed',
            drainError
          );
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Send failed';
        return serverError(message);
      }

      return accepted({ ok: true, queued: true });
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.info(`notifications-service listening on ${String(port)}`);
