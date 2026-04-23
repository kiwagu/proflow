import {
  createSmtpTransportFromEnv,
  sendNotification,
  type EmailNotificationInput,
  type PushNotificationInput,
  type SmsNotificationInput,
} from '@workspace/notifications';
import { gatewayPlatformMountedPath } from '@workspace/gateway-auth/gateway-paths';

type SpaceInviteContext = {
  inviteToken?: unknown;
};

export type OutboxChannelHandler<TPayload = unknown> = {
  channel: string;
  invalidPayloadMessage: string;
  isPayload(value: unknown): value is TPayload;
  deliver(value: TPayload): Promise<void>;
  shouldFailTerminally?(error: unknown): boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function hasTemplatePayload(value: unknown): value is {
  template: { templateKey: string; data: Record<string, unknown> };
} {
  return (
    isRecord(value) &&
    isRecord(value.template) &&
    typeof value.template.templateKey === 'string' &&
    isRecord(value.template.data)
  );
}

function isEmailNotificationInput(
  value: unknown
): value is EmailNotificationInput {
  return (
    isRecord(value) &&
    value.channel === 'email' &&
    typeof value.to === 'string' &&
    typeof value.locale === 'string' &&
    hasTemplatePayload(value)
  );
}

function isSmsNotificationInput(value: unknown): value is SmsNotificationInput {
  return (
    isRecord(value) &&
    value.channel === 'sms' &&
    typeof value.to === 'string' &&
    typeof value.locale === 'string' &&
    hasTemplatePayload(value)
  );
}

function isPushNotificationInput(
  value: unknown
): value is PushNotificationInput {
  return (
    isRecord(value) &&
    value.channel === 'push' &&
    typeof value.locale === 'string' &&
    hasTemplatePayload(value)
  );
}

function publicOriginForInviteLinks(): string {
  return (
    process.env.GATEWAY_ENTRY_ORIGIN?.replace(/\/$/, '') ||
    'http://localhost:3000'
  );
}

function inviteStartUrl(token: string): string {
  const origin = publicOriginForInviteLinks();
  const path = gatewayPlatformMountedPath('/invite/start');
  const query = new URLSearchParams({ t: token });
  return `${origin}${path}?${query.toString()}`;
}

function normalizeEmailNotificationRequest(
  value: EmailNotificationInput
): EmailNotificationInput {
  if (value.template.templateKey !== 'space_invite') {
    return value;
  }

  const payload = value as EmailNotificationInput & {
    context?: SpaceInviteContext;
  };
  const inviteToken = payload.context?.inviteToken;
  if (typeof inviteToken !== 'string' || inviteToken.trim().length === 0) {
    return value;
  }

  return {
    ...value,
    template: {
      ...value.template,
      data: {
        ...value.template.data,
        inviteUrl: inviteStartUrl(inviteToken),
      },
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function createNotImplementedChannelHandler<TPayload>(input: {
  channel: string;
  label: string;
  isPayload(value: unknown): value is TPayload;
}): OutboxChannelHandler<TPayload> {
  return {
    channel: input.channel,
    invalidPayloadMessage: `Outbox payload is not a valid ${input.channel} request`,
    isPayload: input.isPayload,
    async deliver(): Promise<void> {
      throw new Error(`${input.label} channel is not implemented yet`);
    },
    shouldFailTerminally(): boolean {
      return true;
    },
  };
}

const outboxChannelHandlers = [
  {
    channel: 'email',
    invalidPayloadMessage:
      'Outbox payload is not a valid email notification request',
    isPayload: isEmailNotificationInput,
    async deliver(value: EmailNotificationInput): Promise<void> {
      const email = createSmtpTransportFromEnv();
      const request = normalizeEmailNotificationRequest(value);
      await sendNotification(request, { email });
    },
    shouldFailTerminally(error: unknown): boolean {
      const message = errorMessage(error).toLowerCase();
      return (
        message.includes('not implemented') ||
        message.includes('unsupported') ||
        message.includes('invalid')
      );
    },
  },
  createNotImplementedChannelHandler({
    channel: 'sms',
    label: 'SMS',
    isPayload: isSmsNotificationInput,
  }),
  createNotImplementedChannelHandler({
    channel: 'push',
    label: 'Push',
    isPayload: isPushNotificationInput,
  }),
] satisfies OutboxChannelHandler[];

const outboxChannelHandlersByChannel = new Map(
  outboxChannelHandlers.map((handler) => [handler.channel, handler])
);

export function getOutboxChannelHandler(
  channel: string
): OutboxChannelHandler | undefined {
  return outboxChannelHandlersByChannel.get(channel);
}
