import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '@workspace/gateway-auth/supabase/server';

import {
  AUTHOR_RETURN_PATH,
  buildPlatformSignInUrl,
} from '@/lib/auth-redirect';
import { hasEnvVars } from '@/lib/utils';

/**
 * When Supabase env is missing, the proxy does not enforce auth — redirect here.
 * When env is set, `src/proxy.ts` / `updateSession` should 307 guests to platform and
 * signed-in users to `/admin`; this page mirrors that so `/author` never renders blank if
 * the request reaches the RSC (e.g. edge cases around basePath / matcher).
 */
export default async function AuthorRootPage() {
  const h = await headers();

  if (!hasEnvVars) {
    redirect(buildPlatformSignInUrl(AUTHOR_RETURN_PATH, h));
  }

  if (process.env.AUTHOR_E2E_BYPASS_SUPABASE_PROXY === '1') {
    return null;
  }

  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  if (!user) {
    redirect(buildPlatformSignInUrl(AUTHOR_RETURN_PATH, h));
  }

  redirect('/admin');
}
