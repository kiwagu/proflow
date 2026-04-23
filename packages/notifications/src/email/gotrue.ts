import { renderEmail } from './render-email.js';
import { normalizePlatformLocale } from '@workspace/settings-runtime';
import type { AuthEmailActionType, RenderedEmail } from '../types.js';

/** Payload shape sent by Supabase Auth Send Email hook */
export type GoTrueSendEmailHookPayload = {
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

const actionTypes: readonly AuthEmailActionType[] = [
  'signup',
  'magiclink',
  'recovery',
  'email_change',
  'invite',
] as const;

function isAuthEmailActionType(v: string): v is AuthEmailActionType {
  return (actionTypes as readonly string[]).includes(v);
}

/**
 * Resolves locale from user_metadata (e.g. i18n / locale), defaults to en.
 */
export function localeFromGoTrueUser(
  user: GoTrueSendEmailHookPayload['user']
): string {
  const meta = user.user_metadata;
  if (!meta || typeof meta !== 'object') {
    return normalizePlatformLocale(undefined);
  }
  const raw = meta.locale ?? meta.lang ?? meta.language;
  if (typeof raw === 'string' && raw.length > 0) {
    return normalizePlatformLocale(raw);
  }
  return normalizePlatformLocale(undefined);
}

/**
 * Builds confirm URL compatible with PKCE / OTP verify flow
 * (token_hash + type query params).
 */
export function buildAuthConfirmUrl(
  payload: GoTrueSendEmailHookPayload,
  confirmPath: string
): string {
  const { email_data: d } = payload;
  if (!isAuthEmailActionType(d.email_action_type)) {
    throw new Error(`Unsupported email_action_type: ${d.email_action_type}`);
  }

  const base =
    d.redirect_to && d.redirect_to.startsWith('http')
      ? d.redirect_to
      : d.site_url;
  const origin = new URL(base).origin;
  const path = confirmPath.startsWith('/') ? confirmPath : `/${confirmPath}`;
  const url = new URL(path, origin);
  url.searchParams.set('token_hash', d.token_hash);
  url.searchParams.set('type', d.email_action_type);
  return url.toString();
}

export function gotruePayloadToEmailTemplate(
  payload: GoTrueSendEmailHookPayload,
  confirmPath: string
) {
  const { email_data: d } = payload;
  if (!isAuthEmailActionType(d.email_action_type)) {
    throw new Error(`Unsupported email_action_type: ${d.email_action_type}`);
  }
  return {
    templateKey: 'auth_email_action' as const,
    data: {
      confirmUrl: buildAuthConfirmUrl(payload, confirmPath),
      actionType: d.email_action_type,
    },
  };
}

export async function prepareAuthEmailFromGoTrueHook(
  payload: GoTrueSendEmailHookPayload,
  confirmPath: string
): Promise<{ to: string; rendered: RenderedEmail }> {
  const to = payload.user.email;
  if (!to) {
    throw new Error('GoTrue hook payload missing user.email');
  }
  const locale = localeFromGoTrueUser(payload.user);
  const template = gotruePayloadToEmailTemplate(payload, confirmPath);
  const rendered = await renderEmail(locale, template);
  return { to, rendered };
}
