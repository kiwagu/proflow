import type { Database } from '@workspace/db';
import { createClient } from '@supabase/supabase-js';

import { resolveServiceRoleKey, resolveSupabaseUrl } from './test-user.js';

type MaildevMessage = {
  id: string | null;
  subject: string | null;
  recipients: string[];
  text: string;
  html: string;
  raw: unknown;
};

export type E2EOutboxJob = Pick<
  Database['public']['Tables']['outbox_jobs']['Row'],
  | 'id'
  | 'idempotency_key'
  | 'status'
  | 'recipient'
  | 'completed_at'
  | 'last_error'
  | 'payload'
  | 'queue_message_id'
>;

export type GoTrueHookPayload = {
  user: {
    id: string;
    email?: string;
    phone?: string;
    user_metadata?: Record<string, unknown>;
  };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
    token_new?: string;
    token_hash_new?: string;
  };
};

export type DirectEmailAcceptedResponse = {
  ok: true;
  queued: true;
  jobId: string;
  idempotencyKey: string;
  status: string;
};

function notificationsBaseUrl(): string {
  return (
    process.env.E2E_NOTIFICATIONS_URL?.trim() ||
    process.env.NOTIFICATIONS_SERVICE_URL?.trim() ||
    'http://127.0.0.1:3010'
  );
}

function notificationsInternalToken(): string {
  return (
    process.env.E2E_NOTIFICATIONS_INTERNAL_TOKEN?.trim() ||
    process.env.NOTIFICATIONS_INTERNAL_TOKEN?.trim() ||
    'dev-notifications-token'
  );
}

function maildevBaseUrl(): string {
  return process.env.E2E_MAILDEV_URL?.trim() || 'http://127.0.0.1:9090';
}

function serviceSupabase() {
  return createClient<Database>(resolveSupabaseUrl(), resolveServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function extractMailAddress(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim().replace(/^<|>$/g, '');
    return trimmed ? [trimmed.toLowerCase()] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractMailAddress(entry));
  }

  if (!isRecord(value)) {
    return [];
  }

  const address =
    typeof value.address === 'string'
      ? value.address
      : typeof value.email === 'string'
        ? value.email
        : typeof value.path === 'string'
          ? value.path
          : typeof value.user === 'string' && typeof value.host === 'string'
            ? `${value.user}@${value.host}`
            : null;

  return address ? extractMailAddress(address) : [];
}

function messageSubject(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.subject === 'string' && value.subject.trim()) {
    return value.subject.trim();
  }

  const headers = value.headers;
  if (!isRecord(headers)) {
    return null;
  }

  if (typeof headers.subject === 'string' && headers.subject.trim()) {
    return headers.subject.trim();
  }

  if (
    Array.isArray(headers.subject) &&
    typeof headers.subject[0] === 'string'
  ) {
    return headers.subject[0].trim() || null;
  }

  return null;
}

function messageBody(value: unknown, field: 'text' | 'html'): string {
  if (!isRecord(value)) {
    return '';
  }

  const direct = value[field];
  if (typeof direct === 'string') {
    return direct;
  }

  const nested = value[field === 'text' ? 'textContent' : 'htmlContent'];
  return typeof nested === 'string' ? nested : '';
}

function normalizeMaildevMessage(value: unknown): MaildevMessage {
  return {
    id: isRecord(value) && typeof value.id === 'string' ? value.id : null,
    subject: messageSubject(value),
    recipients: isRecord(value) ? extractMailAddress(value.to) : [],
    text: messageBody(value, 'text'),
    html: messageBody(value, 'html'),
    raw: value,
  };
}

function isDirectEmailAcceptedResponse(
  value: unknown
): value is DirectEmailAcceptedResponse {
  return (
    isRecord(value) &&
    value.ok === true &&
    value.queued === true &&
    typeof value.jobId === 'string' &&
    typeof value.idempotencyKey === 'string' &&
    typeof value.status === 'string'
  );
}

export async function notificationsHealthcheck(): Promise<void> {
  const response = await fetch(`${notificationsBaseUrl()}/health`);
  if (!response.ok) {
    throw new Error(
      `notifications-service health failed: ${response.status} ${response.statusText}`
    );
  }
}

export async function maildevHealthcheck(): Promise<void> {
  const response = await fetch(`${maildevBaseUrl()}/email`);
  if (!response.ok) {
    throw new Error(
      `maildev health failed: ${response.status} ${response.statusText}`
    );
  }
}

export async function postDirectEmailRequest(input: {
  idempotencyKey: string;
  body: Record<string, unknown>;
}): Promise<DirectEmailAcceptedResponse> {
  const response = await fetch(
    `${notificationsBaseUrl()}/v1/notifications/email`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${notificationsInternalToken()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify(input.body),
    }
  );

  if (response.status !== 202) {
    throw new Error(
      `direct email request failed: ${response.status} ${await response.text()}`
    );
  }

  const json: unknown = await response.json();
  if (!isDirectEmailAcceptedResponse(json)) {
    throw new Error('direct email request returned an unexpected payload');
  }

  return json;
}

export async function postGoTrueSendEmailHook(
  payload: GoTrueHookPayload
): Promise<void> {
  const response = await fetch(
    `${notificationsBaseUrl()}/v1/hooks/gotrue/send-email`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${notificationsInternalToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  if (response.status !== 202) {
    throw new Error(
      `gotrue hook request failed: ${response.status} ${await response.text()}`
    );
  }
}

export async function listOutboxJobsByIdempotencyKey(
  idempotencyKey: string
): Promise<E2EOutboxJob[]> {
  const supabase = serviceSupabase();
  const { data, error } = await supabase
    .from('outbox_jobs')
    .select(
      'id,idempotency_key,status,recipient,completed_at,last_error,payload,queue_message_id'
    )
    .eq('idempotency_key', idempotencyKey)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`outbox lookup failed: ${error.message}`);
  }

  return data ?? [];
}

export async function deleteOutboxJobsByIdempotencyKeys(
  idempotencyKeys: string[]
): Promise<void> {
  if (idempotencyKeys.length === 0) {
    return;
  }

  const supabase = serviceSupabase();
  const { error } = await supabase
    .from('outbox_jobs')
    .delete()
    .in('idempotency_key', idempotencyKeys);

  if (error) {
    throw new Error(`outbox cleanup failed: ${error.message}`);
  }
}

export async function findLatestInviteByEmail(input: {
  spaceId: string;
  email: string;
}): Promise<{ id: string; token: string } | null> {
  const supabase = serviceSupabase();
  const { data, error } = await supabase
    .from('space_invites')
    .select('id,token')
    .eq('space_id', input.spaceId)
    .eq('email', input.email.toLowerCase())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`space_invites lookup failed: ${error.message}`);
  }

  return data;
}

export async function listMaildevMessagesByRecipient(
  recipientEmail: string
): Promise<MaildevMessage[]> {
  const response = await fetch(`${maildevBaseUrl()}/email`);
  if (!response.ok) {
    throw new Error(
      `maildev list failed: ${response.status} ${response.statusText}`
    );
  }

  const json: unknown = await response.json();
  if (!Array.isArray(json)) {
    throw new Error('maildev returned a non-array payload');
  }

  const target = recipientEmail.toLowerCase();
  return json
    .map((message) => normalizeMaildevMessage(message))
    .filter((message) => message.recipients.includes(target));
}
