import { render } from '@react-email/render';
import * as React from 'react';

import { getTranslator } from '../i18n/get-translator.js';
import type {
  AuthEmailActionTemplateData,
  EmailTemplatePayload,
  Locale,
  RenderedEmail,
} from '../types.js';
import { AuthEmailAction } from './templates/AuthEmailAction.js';
import { SpaceInviteEmail } from './templates/SpaceInviteEmail.js';

function authActionTranslationKeySuffix(
  actionType: AuthEmailActionTemplateData['actionType']
): string {
  if (actionType === 'email_change') {
    return 'emailChange';
  }

  if (actionType === 'magiclink') {
    return 'magicLink';
  }

  return actionType;
}

function subjectForAction(
  t: ReturnType<typeof getTranslator>,
  actionType: AuthEmailActionTemplateData['actionType']
): string {
  return t(`email.auth.subject.${authActionTranslationKeySuffix(actionType)}`);
}

export async function renderEmail(
  locale: Locale | string | undefined,
  template: EmailTemplatePayload
): Promise<RenderedEmail> {
  const t = getTranslator(locale);

  if (template.templateKey === 'auth_email_action') {
    const { confirmUrl, actionType } = template.data;
    const actionKey = authActionTranslationKeySuffix(actionType);
    const title = t(`email.auth.title.${actionKey}`);
    const lead = t(`email.auth.lead.${actionKey}`);
    const ctaLabel = t(`email.auth.cta.${actionKey}`);
    const previewText = t('email.auth.preview');
    const footer = t('email.auth.footer');
    const subject = subjectForAction(t, actionType);

    const element = React.createElement(AuthEmailAction, {
      previewText,
      title,
      lead,
      ctaLabel,
      confirmUrl,
      footer,
    });

    const html = await render(element);
    const text = await render(element, { plainText: true });

    return { subject, html, text };
  }

  if (template.templateKey === 'space_invite') {
    const { inviteUrl, spaceName, organizationName, expiresAtUtc } =
      template.data;
    const previewText = t('email.spaceInvite.preview');
    const subject = t('email.spaceInvite.subject', {
      spaceName,
      organizationName,
    });
    const title = t('email.spaceInvite.title');
    const lead = t('email.spaceInvite.lead', {
      spaceName,
      organizationName,
    });
    const ctaLabel = t('email.spaceInvite.cta');
    const expiresLine = t('email.spaceInvite.expires', {
      expiresAt: expiresAtUtc,
    });
    const linkFallbackLabel = t('email.spaceInvite.linkFallback');
    const footer = t('email.spaceInvite.footer');

    const element = React.createElement(SpaceInviteEmail, {
      previewText,
      title,
      lead,
      ctaLabel,
      inviteUrl,
      expiresLine,
      linkFallbackLabel,
      footer,
    });

    const html = await render(element);
    const text = await render(element, { plainText: true });

    return { subject, html, text };
  }

  throw new Error('Unknown email template key');
}
