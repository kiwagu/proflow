import { type NotificationRequest } from '@workspace/notifications';
import type { Json } from '@workspace/db';

import {
  createServiceRoleSupabaseClient,
  isServiceRoleSupabaseConfigured,
} from './supabase.js';
import { getOutboxChannelHandler } from './outbox-channel-handlers.js';

type OutboxJob = {
  id: string;
  channel: string;
  payload: unknown;
  claim_token: string;
};

type OutboxEnqueueResult = {
  id: string;
  idempotency_key: string;
  status: string;
};

type OutboxMetricsChannel = {
  channel: string;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  retried_total: number;
  oldest_pending_job_age_seconds: number;
  oldest_pending_lag_seconds: number;
  oldest_processing_age_seconds: number;
  stale_processing: number;
};

type OutboxMetricsSummary = {
  pending_total: number;
  processing_total: number;
  completed_total: number;
  terminal_failures_total: number;
  terminal_failures_in_window: number;
  retried_jobs_total: number;
  retry_backlog_total: number;
  oldest_pending_job_age_seconds: number;
  oldest_pending_lag_seconds: number;
  oldest_processing_age_seconds: number;
  stale_processing_total: number;
  failed_since_hours: number;
  processing_stale_after_seconds: number;
};

export type OutboxMetrics = {
  observed_at: string;
  summary: OutboxMetricsSummary;
  backlog_by_channel: OutboxMetricsChannel[];
};

const OUTBOX_CONSUMER =
  process.env.NOTIFICATIONS_OUTBOX_CONSUMER?.trim() ||
  `notifications-service:${process.pid}`;
const OUTBOX_BATCH_SIZE = Number(
  process.env.NOTIFICATIONS_OUTBOX_BATCH_SIZE ?? '10'
);
const OUTBOX_POLL_INTERVAL_MS = Number(
  process.env.NOTIFICATIONS_OUTBOX_POLL_INTERVAL_MS ?? '1000'
);
const OUTBOX_RETRY_SECONDS = Number(
  process.env.NOTIFICATIONS_OUTBOX_RETRY_SECONDS ?? '60'
);

let pollTimer: ReturnType<typeof setInterval> | null = null;
let draining = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function toJsonValue(value: unknown): Json {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item));
  }

  if (isRecord(value)) {
    const normalized: Record<string, Json | undefined> = {};
    for (const [key, entry] of Object.entries(value)) {
      normalized[key] =
        typeof entry === 'undefined' ? undefined : toJsonValue(entry);
    }
    return normalized;
  }

  return String(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isOutboxEnqueueResult(value: unknown): value is OutboxEnqueueResult {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.idempotency_key === 'string' &&
    typeof value.status === 'string'
  );
}

function isOutboxMetricsChannel(value: unknown): value is OutboxMetricsChannel {
  return (
    isRecord(value) &&
    typeof value.channel === 'string' &&
    isNumber(value.pending) &&
    isNumber(value.processing) &&
    isNumber(value.completed) &&
    isNumber(value.failed) &&
    isNumber(value.retried_total) &&
    isNumber(value.oldest_pending_job_age_seconds) &&
    isNumber(value.oldest_pending_lag_seconds) &&
    isNumber(value.oldest_processing_age_seconds) &&
    isNumber(value.stale_processing)
  );
}

function isOutboxMetricsSummary(value: unknown): value is OutboxMetricsSummary {
  return (
    isRecord(value) &&
    isNumber(value.pending_total) &&
    isNumber(value.processing_total) &&
    isNumber(value.completed_total) &&
    isNumber(value.terminal_failures_total) &&
    isNumber(value.terminal_failures_in_window) &&
    isNumber(value.retried_jobs_total) &&
    isNumber(value.retry_backlog_total) &&
    isNumber(value.oldest_pending_job_age_seconds) &&
    isNumber(value.oldest_pending_lag_seconds) &&
    isNumber(value.oldest_processing_age_seconds) &&
    isNumber(value.stale_processing_total) &&
    isNumber(value.failed_since_hours) &&
    isNumber(value.processing_stale_after_seconds)
  );
}

function isOutboxMetrics(value: unknown): value is OutboxMetrics {
  return (
    isRecord(value) &&
    typeof value.observed_at === 'string' &&
    isOutboxMetricsSummary(value.summary) &&
    Array.isArray(value.backlog_by_channel) &&
    value.backlog_by_channel.every(isOutboxMetricsChannel)
  );
}

async function claimJobs(): Promise<OutboxJob[]> {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase.rpc('rpc_outbox_claim_jobs', {
    p_consumer: OUTBOX_CONSUMER,
    p_limit: Math.max(OUTBOX_BATCH_SIZE, 1),
    // Narrow the claim to the notifications domains. The universal outbox also
    // carries `operation` rows (e.g. the slice-08 body-bridge), which this worker
    // has no handler for — claiming them would falsely terminal-DLQ a row owned by
    // another consumer. Restricting the claim keeps the two workers off each
    // other's rows. (slice-08 §8.1 #3.)
    p_channels: ['email', 'sms', 'push'],
  });

  if (error) {
    throw new Error(`Failed to claim outbox jobs: ${error.message}`);
  }

  return Array.isArray(data) ? (data as OutboxJob[]) : [];
}

export async function enqueueNotificationRequest(
  request: NotificationRequest,
  options: {
    aggregateType: string;
    aggregateId: string;
    eventName: string;
    idempotencyKey: string;
    context?: Record<string, unknown>;
  }
): Promise<{ jobId: string; idempotencyKey: string; status: string }> {
  const supabase = createServiceRoleSupabaseClient();
  const payload = options.context
    ? { ...request, context: options.context }
    : request;
  const templateKey =
    isRecord(request.template) &&
    typeof request.template.templateKey === 'string'
      ? request.template.templateKey
      : undefined;
  const recipient = 'to' in request ? request.to : undefined;

  const { data, error } = await supabase.rpc('rpc_enqueue_outbox_job', {
    p_aggregate_type: options.aggregateType,
    p_aggregate_id: options.aggregateId,
    p_event_name: options.eventName,
    p_channel: request.channel,
    p_template_key: templateKey,
    p_recipient: recipient,
    p_locale: request.locale,
    p_payload: toJsonValue(payload),
    p_idempotency_key: options.idempotencyKey,
  });

  if (error) {
    throw new Error(`Failed to enqueue outbox job: ${error.message}`);
  }

  if (!isOutboxEnqueueResult(data)) {
    throw new Error('Outbox enqueue returned an unexpected payload');
  }

  return {
    jobId: data.id,
    idempotencyKey: data.idempotency_key,
    status: data.status,
  };
}

export async function getNotificationsOutboxMetrics(options?: {
  failedSinceHours?: number;
  processingStaleAfterSeconds?: number;
}): Promise<OutboxMetrics> {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase.rpc('rpc_outbox_metrics', {
    p_failed_since_hours: options?.failedSinceHours,
    p_processing_stale_after_seconds: options?.processingStaleAfterSeconds,
  });

  if (error) {
    throw new Error(`Failed to load outbox metrics: ${error.message}`);
  }

  if (!isOutboxMetrics(data)) {
    throw new Error('Outbox metrics returned an unexpected payload');
  }

  return data;
}

async function completeJob(job: OutboxJob): Promise<void> {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase.rpc('rpc_outbox_complete_job', {
    p_job_id: job.id,
    p_claim_token: job.claim_token,
  });

  if (error) {
    throw new Error(
      `Failed to complete outbox job ${job.id}: ${error.message}`
    );
  }

  if (data !== true) {
    throw new Error(`Outbox job ${job.id} completion was rejected`);
  }
}

async function retryJob(
  job: OutboxJob,
  reason: string,
  terminal: boolean
): Promise<void> {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase.rpc('rpc_outbox_retry_job', {
    p_job_id: job.id,
    p_claim_token: job.claim_token,
    p_error: reason,
    p_retry_seconds: Math.max(OUTBOX_RETRY_SECONDS, 1),
    p_terminal: terminal,
  });

  if (error) {
    throw new Error(`Failed to release outbox job ${job.id}: ${error.message}`);
  }

  if (data !== true) {
    throw new Error(`Outbox job ${job.id} release was rejected`);
  }
}

async function processJob(job: OutboxJob): Promise<void> {
  const handler = getOutboxChannelHandler(job.channel);
  if (!handler) {
    await retryJob(
      job,
      `Outbox channel "${job.channel}" is not registered in notifications-service`,
      true
    );
    return;
  }

  if (!handler.isPayload(job.payload)) {
    await retryJob(job, handler.invalidPayloadMessage, true);
    return;
  }

  try {
    await handler.deliver(job.payload);
    await completeJob(job);
  } catch (error) {
    const message = errorMessage(error);
    await retryJob(
      job,
      message,
      handler.shouldFailTerminally?.(error) ?? false
    );
  }
}

export async function drainNotificationsOutboxOnce(): Promise<void> {
  if (draining) {
    return;
  }

  draining = true;

  try {
    while (true) {
      const jobs = await claimJobs();
      if (jobs.length === 0) {
        return;
      }

      for (const job of jobs) {
        await processJob(job);
      }

      if (jobs.length < Math.max(OUTBOX_BATCH_SIZE, 1)) {
        return;
      }
    }
  } finally {
    draining = false;
  }
}

export function startNotificationsOutboxWorker(): void {
  if (pollTimer) {
    return;
  }

  if (!isServiceRoleSupabaseConfigured()) {
    console.warn(
      'notifications-service: Supabase service-role env missing; outbox worker disabled'
    );
    return;
  }

  pollTimer = setInterval(
    () => {
      void drainNotificationsOutboxOnce().catch((error) => {
        console.error('notifications-service: outbox drain failed', error);
      });
    },
    Math.max(OUTBOX_POLL_INTERVAL_MS, 250)
  );

  pollTimer.unref?.();

  void drainNotificationsOutboxOnce().catch((error) => {
    console.error('notifications-service: initial outbox drain failed', error);
  });
}
