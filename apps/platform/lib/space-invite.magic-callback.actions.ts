'use server';

import { createClient } from '@/lib/supabase/server';

export type ExchangeInviteMagicCallbackResult =
  { ok: true } | { ok: false; message: string };

/**
 * Finishes PKCE magic-link sign-in; sets auth cookies for the platform origin.
 */
export async function exchangeInviteMagicCallbackAction(
  code: string
): Promise<ExchangeInviteMagicCallbackResult> {
  const trimmed = code.trim();
  if (!trimmed) {
    return { ok: false, message: 'Missing authorization code.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(trimmed);
  if (error) {
    return {
      ok: false,
      message:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Could not verify sign-in.',
    };
  }

  return { ok: true };
}
