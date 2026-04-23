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
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images - .svg, .png, .jpg, .jpeg, .gif, .webp
     * With `basePath`, include `/` explicitly so the app root is covered (see author proxy).
     */
    '/',
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
