import 'server-only';

import { clearCanonicalActiveSpaceCookie } from '@workspace/gateway-auth/active-space.cookie';
import {
  PASSWORD_RECOVERY_COOKIE,
  recoveryPendingCookieOptions,
} from '@workspace/gateway-auth/password-recovery';

import { createClient } from '@/lib/supabase/server';

type CookieSetter = {
  set(
    name: string,
    value: string,
    options?: {
      httpOnly?: boolean;
      path?: string;
      sameSite?: 'lax' | 'strict' | 'none';
      secure?: boolean;
      maxAge?: number;
    }
  ): void;
};

export async function signOutPlatformSession(
  cookieStore: CookieSetter,
  requestHeaders?: Headers
): Promise<void> {
  const supabase = await createClient();
  // scope: 'local' avoids an unnecessary remote revocation round-trip while
  // still clearing the current browser session cookies.
  await supabase.auth.signOut({ scope: 'local' });

  clearCanonicalActiveSpaceCookie(cookieStore);

  cookieStore.set(PASSWORD_RECOVERY_COOKIE, '', {
    ...(requestHeaders
      ? recoveryPendingCookieOptions(requestHeaders)
      : {
          path: '/',
          sameSite: 'lax' as const,
          secure: process.env.NODE_ENV === 'production',
        }),
    maxAge: 0,
  });
}
