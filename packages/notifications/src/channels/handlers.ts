import type {
  EmailNotificationInput,
  EmailTransport,
  NotificationChannel,
  NotificationRequest,
  PushTransport,
  SmsTransport,
} from '../types.js';
import { renderEmail } from '../email/render-email.js';

export type NotificationTransports = {
  email?: EmailTransport;
  sms?: SmsTransport;
  push?: PushTransport;
};

export type NotificationChannelDispatcher<
  TChannel extends NotificationChannel = NotificationChannel,
> = {
  channel: TChannel;
  dispatch(
    request: NotificationRequest,
    transports: NotificationTransports
  ): Promise<void>;
};

function createNotificationChannelDispatcher<
  TChannel extends NotificationChannel,
>(
  dispatcher: NotificationChannelDispatcher<TChannel>
): NotificationChannelDispatcher<TChannel> {
  return dispatcher;
}

const notificationChannelDispatchers = {
  email: createNotificationChannelDispatcher({
    channel: 'email',
    async dispatch(
      request: NotificationRequest,
      transports: NotificationTransports
    ): Promise<void> {
      const emailRequest = request as EmailNotificationInput;

      if (!transports.email) {
        throw new Error('Email transport is not configured');
      }

      const rendered = await renderEmail(
        emailRequest.locale,
        emailRequest.template
      );
      await transports.email.send({
        to: emailRequest.to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
    },
  }),
  sms: createNotificationChannelDispatcher({
    channel: 'sms',
    async dispatch(
      _request: NotificationRequest,
      _transports: NotificationTransports
    ): Promise<void> {
      throw new Error('SMS channel is not implemented yet');
    },
  }),
  push: createNotificationChannelDispatcher({
    channel: 'push',
    async dispatch(
      _request: NotificationRequest,
      _transports: NotificationTransports
    ): Promise<void> {
      throw new Error('Push channel is not implemented yet');
    },
  }),
} satisfies {
  [TChannel in NotificationChannel]: NotificationChannelDispatcher<TChannel>;
};

export function getNotificationChannelDispatcher(
  channel: NotificationChannel
): NotificationChannelDispatcher {
  return notificationChannelDispatchers[channel];
}
