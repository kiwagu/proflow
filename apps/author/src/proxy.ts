/**
 * Next.js only discovers `proxy.ts` next to the `app` directory. With `src/app`, the file must live
 * under `src/` (not the package root), or auth redirects never run.
 */
import { logMutatingRequestInDev } from '@workspace/gateway-auth/dev-mutating-request-log';
import { type NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  const response = await updateSession(request);
  logMutatingRequestInDev(request);
  return response;
}

export const config = {
  matcher: [
    /*
     * With `basePath`, a single regex often misses the app root; include `/` explicitly
     * so unauthenticated guests get a server redirect (307) instead of a blank page.
     */
    '/',
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
