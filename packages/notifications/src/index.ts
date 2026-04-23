export type {
  AuthEmailActionTemplateData,
  AuthEmailActionType,
  EmailNotificationInput,
  EmailTemplateKey,
  EmailTemplatePayload,
  EmailTransport,
  Locale,
  NotificationChannel,
  NotificationRequest,
  PushNotificationInput,
  PushTransport,
  RenderedEmail,
  SmsNotificationInput,
  SmsTransport,
  SpaceInviteTemplateData,
} from './types.js';

export {
  buildAuthConfirmUrl,
  gotruePayloadToEmailTemplate,
  localeFromGoTrueUser,
  prepareAuthEmailFromGoTrueHook,
} from './email/gotrue.js';
export type { GoTrueSendEmailHookPayload } from './email/gotrue.js';

export { renderEmail } from './email/render-email.js';
export { AuthEmailAction } from './email/templates/AuthEmailAction.js';
export type { AuthEmailActionProps } from './email/templates/AuthEmailAction.js';
export { SpaceInviteEmail } from './email/templates/SpaceInviteEmail.js';
export type { SpaceInviteEmailProps } from './email/templates/SpaceInviteEmail.js';

export { getTranslator } from './i18n/get-translator.js';
export type { Translate } from './i18n/get-translator.js';
export {
  defaultLocale,
  getMessages,
  initializeMessages,
} from './i18n/messages.js';

export { sendNotification } from './channels/dispatch.js';
export type { NotificationTransports } from './channels/handlers.js';
export { getNotificationChannelDispatcher } from './channels/handlers.js';
export type { NotificationChannelDispatcher } from './channels/handlers.js';

export {
  createSmtpTransportFromEnv,
  SmtpEmailTransport,
} from './transports/smtp.js';
export type { SmtpTransportOptions } from './transports/smtp.js';
