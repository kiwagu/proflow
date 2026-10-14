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
  const sync = syncTarget();
  // What the person may change there, so the workbench offers no control
  // the server would refuse. Derived by the database from the same verbs its
  // write policies use; a failed call only leaves it out.
  const writeScope = spaceId
    ? ((await supabase.rpc('rpc_my_write_scope', { p_space_id: spaceId }))
        .data ?? null)
    : null;
  const response = NextResponse.json(
    {
      userId: data.user.id,
      email: data.user.email ?? '',
      spaceId,
      spaceName: spaces.find((space) => space.id === spaceId)?.name ?? null,
      ...(sync ? { sync } : {}),
      ...(writeScope ? { writeScope } : {}),
    },
    { headers }
  );
  if (spaceId) setCanonicalActiveSpaceCookie(response.cookies, spaceId);
  return response;
}

/**
 * Where the SPA's replica talks to, and with which publishable key.
 *
 * The SPA is a static bundle served from the gateway, so it has no build of
 * its own per deployment: pinning an origin and a key into it would make
 * every deployment need its own build. Both values are public by design —
 * the key is the anonymous one the browser already receives here, and row
 * level security, not secrecy, is what decides access. Absent when the
 * server is not configured for it, in which case the SPA simply does not
 * replicate.
 */
function syncTarget(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}
