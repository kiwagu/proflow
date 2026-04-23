import { Webhook } from 'npm:standardwebhooks@1.0.0';

import { headerRecord } from '../_shared/headerRecord.ts';
import { parseWhsecSecret } from '../_shared/parseWhsecSecret.ts';

const notificationsServiceUrl =
  Deno.env.get('NOTIFICATIONS_SERVICE_URL') ?? 'http://172.22.0.1:3010';
const notificationsInternalToken = Deno.env.get('NOTIFICATIONS_INTERNAL_TOKEN') ?? '';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const secretRaw = Deno.env.get('AUTH_HOOK_SEND_EMAIL_SECRETS');
  if (!secretRaw) {
    console.error('AUTH_HOOK_SEND_EMAIL_SECRETS is not set');
    return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let wh: Webhook;
  try {
    wh = new Webhook(parseWhsecSecret(secretRaw));
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: 'Invalid webhook secret config' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rawBody = await req.text();

  try {
    wh.verify(rawBody, headerRecord(req));
  } catch (e) {
    console.error('Webhook verification failed', e);
    return new Response(JSON.stringify({ error: 'Invalid signature' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!notificationsInternalToken) {
    console.error('NOTIFICATIONS_INTERNAL_TOKEN is not set');
    return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const response = await fetch(
      `${notificationsServiceUrl.replace(/\/+$/, '')}/v1/hooks/gotrue/send-email`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${notificationsInternalToken}`,
        },
        body: JSON.stringify(payload),
      }
    );
    if (!response.ok) {
      const errorText = await response.text();
      console.error('notifications-service responded with error', response.status, errorText);
      return new Response(JSON.stringify({ error: 'Failed to send email' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (e) {
    console.error('notifications-service request failed', e);
    return new Response(JSON.stringify({ error: 'Failed to send email' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
