import { type NextRequest, NextResponse } from 'next/server';

import {
  gatewayPlatformMountedPath,
  getGatewayPlatformPath,
} from '@workspace/gateway-auth/gateway-paths';
import { resolvePublicSiteOrigin } from '@workspace/gateway-auth/site-origin';

import {
  resolveAuthUserForSpaceInviteEmail,
  spaceInviteeNeedsPasswordStep,
} from '@/lib/space-invite.auth-lookup.server';
import { createServiceRoleSupabaseClient } from '@/lib/supabase/service-role';
import { createClient } from '@/lib/supabase/server';

function appErrorRedirect(request: NextRequest, reason: string): NextResponse {
  const origin = resolvePublicSiteOrigin(request.headers);
  const url = new URL(gatewayPlatformMountedPath('/invite/error'), origin);
  url.searchParams.set('reason', reason);
  return NextResponse.redirect(url);
}

/**
 * Space invite email entry.
 *
 * 1. Validates the invite token.
 * 2. Generates a magic-link via the admin API.
 * 3. Verifies the OTP server-side (`verifyOtp`) so the session is established
 *    without a browser round-trip through GoTrue.
 * 4. Redirects to `/invite/complete` (existing users) or `/invite/set-password`
 *    (new users who need a password).
 *
 * If server-side `verifyOtp` fails, falls back to the GoTrue browser redirect
 * (original implicit-flow behaviour).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get('t')?.trim() ?? '';
  if (!token) {
    return appErrorRedirect(request, 'missing_token');
  }

  let admin: ReturnType<typeof createServiceRoleSupabaseClient>;
  try {
    admin = createServiceRoleSupabaseClient();
  } catch {
    return appErrorRedirect(request, 'server_misconfigured');
  }

  const { data: invite, error: invErr } = await admin
    .from('space_invites')
    .select('id,email,token,status,expires_at,space_id')
    .eq('token', token)
    .maybeSingle();

  if (invErr || !invite || invite.status !== 'pending') {
    return appErrorRedirect(request, 'invalid_invite');
  }

  const expiresAt = new Date(invite.expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
    return appErrorRedirect(request, 'expired');
  }

  const authUser = await resolveAuthUserForSpaceInviteEmail(
    admin,
    invite.email
  );
  const nextStep = spaceInviteeNeedsPasswordStep(authUser)
    ? 'password'
    : 'complete';

  const origin = resolvePublicSiteOrigin(request.headers);
  const mount = getGatewayPlatformPath();
  const callbackPath = `${mount}/invite/magic-callback?t=${encodeURIComponent(token)}&next=${nextStep}`;
  const redirectTo = `${origin}${callbackPath}`;

  const { data: linkData, error: glErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: invite.email,
    options: {
      redirectTo,
      data: { space_invite_id: invite.id },
    },
  });

  const hashedToken = linkData?.properties?.hashed_token;
  const actionLink = linkData?.properties?.action_link;
  if (glErr || !hashedToken) {
    return appErrorRedirect(request, 'magic_link_failed');
  }

  // ── Server-side session establishment ──
  // Verify the OTP via the SSR Supabase client so auth cookies are set on the
  // response without a browser round-trip through GoTrue.
  const supabase = await createClient();
  const { error: verifyErr } = await supabase.auth.verifyOtp({
    token_hash: hashedToken,
    type: 'magiclink',
  });

  if (!verifyErr) {
    // Session established — redirect straight to the next step.
    const nextPath =
      nextStep === 'password'
        ? `/invite/set-password?t=${encodeURIComponent(token)}`
        : `/invite/complete?t=${encodeURIComponent(token)}`;
    const dest = new URL(gatewayPlatformMountedPath(nextPath), origin);
    return NextResponse.redirect(dest, 302);
  }

  // ── Fallback: GoTrue browser redirect (implicit flow) ──
  if (actionLink) {
    return NextResponse.redirect(actionLink, 302);
  }
  return appErrorRedirect(request, 'magic_link_failed');
}
