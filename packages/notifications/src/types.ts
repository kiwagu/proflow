import type { PlatformLocale } from '@workspace/settings-runtime';

export type Locale = PlatformLocale;

export type NotificationChannel = 'email' | 'sms' | 'push';

/** GoTrue / Supabase auth email_action_type values */
export type AuthEmailActionType =
  'signup' | 'magiclink' | 'recovery' | 'email_change' | 'invite';

export type EmailTemplateKey = 'auth_email_action' | 'space_invite';

export type AuthEmailActionTemplateData = {
  confirmUrl: string;
  actionType: AuthEmailActionType;
};

export type SpaceInviteTemplateData = {
  inviteUrl: string;
  spaceName: string;
  organizationName: string;
  /** Shown in the email body (e.g. ISO timestamp, UTC). */
  expiresAtUtc: string;
};

export type EmailTemplatePayload =
  | {
      templateKey: 'auth_email_action';
      data: AuthEmailActionTemplateData;
    }
  | {
      templateKey: 'space_invite';
      data: SpaceInviteTemplateData;
    };

export type EmailNotificationInput = {
  channel: 'email';
  to: string;
  /** BCP 47 / short code; unknown values fall back via `getTranslator`. */
  locale: string;
  template: EmailTemplatePayload;
};

export type SmsNotificationInput = {
  channel: 'sms';
  to: string;
  locale: Locale;
  template: { templateKey: string; data: Record<string, unknown> };
};

export type PushNotificationInput = {
  channel: 'push';
  locale: Locale;
  template: { templateKey: string; data: Record<string, unknown> };
};

export type NotificationRequest =
  EmailNotificationInput | SmsNotificationInput | PushNotificationInput;

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

export interface EmailTransport {
  send(input: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void>;
}

export type SmsTransport = {
  send(_input: { to: string; body: string }): Promise<void>;
};

export type PushTransport = {
  send(_input: {
    title: string;
    body: string;
    data?: Record<string, string>;
  }): Promise<void>;
};
