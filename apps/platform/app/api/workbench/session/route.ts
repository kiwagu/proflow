import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  listAccessibleSpacesForUser,
  readActiveSpaceIdFromCookies,
  resolveActiveSpaceIdForAccessibleSpaces,
} from '@/lib/active-space';
import { setCanonicalActiveSpaceCookie } from '@workspace/gateway-auth/active-space.cookie';
import { PASSWORD_RECOVERY_COOKIE } from '@workspace/gateway-auth/password-recovery';

export const dynamic = 'force-dynamic';

/** The SPA shares Platform's session and space selection, never a client-supplied actor. */
export async function GET(request: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
  if (request.cookies.get(PASSWORD_RECOVERY_COOKIE)?.value === '1') {
    return NextResponse.json(
      { error: 'password_recovery_pending' },
      { status: 401, headers }
    );
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error && (error.status ?? 0) >= 500) {
    return NextResponse.json(
      { error: 'session_unavailable' },
      { status: 503, headers }
    );
  }
  if (error || !data.user) {
    return NextResponse.json(
      { error: 'unauthenticated' },
      { status: 401, headers }
    );
  }
  const { spaces } = await listAccessibleSpacesForUser(supabase, data.user.id);
  const spaceId = resolveActiveSpaceIdForAccessibleSpaces(
    spaces,
    readActiveSpaceIdFromCookies(request.cookies)
  );
  const response = NextResponse.json(
    {
      userId: data.user.id,
      email: data.user.email ?? '',
      spaceId,
      spaceName: spaces.find((space) => space.id === spaceId)?.name ?? null,
    },
    { headers }
  );
  if (spaceId) setCanonicalActiveSpaceCookie(response.cookies, spaceId);
  return response;
}
