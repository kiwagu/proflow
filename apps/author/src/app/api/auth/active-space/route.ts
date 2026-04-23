import config from '@payload-config';
import { NextResponse } from 'next/server';
import { createPayloadRequest } from 'payload';

import { ACTIVE_SPACE_COOKIE } from '@workspace/gateway-auth/active-space.constants';
import { setCanonicalActiveSpaceCookie } from '@workspace/gateway-auth/active-space.cookie';
import type { Database } from '@workspace/db';
import { createClient as createServiceClient } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/server';

type ActiveSpaceRequestBody = {
  spaceId?: unknown;
};

const PAYLOAD_TENANT_COOKIE = 'payload-tenant';

function serviceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !serviceRole) {
    return null;
  }

  return createServiceClient<Database>(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function readSpaceId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readCookieFromRequest(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) {
    return null;
  }

  for (const rawPart of cookieHeader.split(';')) {
    const [rawName, ...rawValueParts] = rawPart.split('=');
    if (!rawName || rawName.trim() !== name) {
      continue;
    }

    const rawValue = rawValueParts.join('=').trim();
    if (!rawValue) {
      return null;
    }

    const decoded = decodeURIComponent(rawValue).trim();
    return decoded.length > 0 ? decoded : null;
  }

  return null;
}

async function listActiveSpaceIdsForUser(userId: string): Promise<string[]> {
  const supabase = serviceSupabase();
  if (!supabase) {
    throw new Error('Supabase service role is not configured.');
  }

  const { data, error } = await supabase
    .from('space_memberships')
    .select('space_id')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? [])
    .map((row) => readSpaceId(row.space_id))
    .filter((spaceId): spaceId is string => spaceId !== null);
}

async function resolveDefaultActiveSpaceId(
  spaceIds: string[]
): Promise<string | null> {
  if (spaceIds.length === 0) {
    return null;
  }

  const supabase = serviceSupabase();
  if (!supabase) {
    throw new Error('Supabase service role is not configured.');
  }

  const { data, error } = await supabase
    .from('spaces')
    .select('id')
    .in('id', spaceIds)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return readSpaceId(data?.id);
}

async function resolveAuthoritativeActiveSpaceId(
  request: Request,
  userId: string
): Promise<string | null> {
  const activeSpaceIds = await listActiveSpaceIdsForUser(userId);
  if (activeSpaceIds.length === 0) {
    return null;
  }

  const canonicalActiveSpaceId = readCookieFromRequest(
    request,
    ACTIVE_SPACE_COOKIE
  );
  if (
    canonicalActiveSpaceId &&
    activeSpaceIds.includes(canonicalActiveSpaceId)
  ) {
    return canonicalActiveSpaceId;
  }

  const payloadTenantId = readCookieFromRequest(request, PAYLOAD_TENANT_COOKIE);
  if (payloadTenantId && activeSpaceIds.includes(payloadTenantId)) {
    return payloadTenantId;
  }

  return resolveDefaultActiveSpaceId(activeSpaceIds);
}

async function resolveAuthenticatedSupabaseUserId(
  request: Request
): Promise<string | null> {
  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();

  if (!userErr && userData.user?.id) {
    return userData.user.id;
  }

  try {
    const payloadRequest = await createPayloadRequest({
      config,
      request,
    });
    const supabaseSub = (
      payloadRequest.user as { supabaseSub?: unknown } | null
    )?.supabaseSub;

    return typeof supabaseSub === 'string' && supabaseSub.trim().length > 0
      ? supabaseSub.trim()
      : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const userId = await resolveAuthenticatedSupabaseUserId(request);
  if (!userId) {
    return NextResponse.json(
      { message: 'Not authenticated.' },
      { status: 401 }
    );
  }

  try {
    const spaceId = await resolveAuthoritativeActiveSpaceId(request, userId);

    return NextResponse.json(
      { spaceId },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not read active space.';
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = (await request
    .json()
    .catch(() => null)) as ActiveSpaceRequestBody | null;
  const spaceId = readSpaceId(body?.spaceId);

  if (!spaceId) {
    return NextResponse.json(
      { message: 'Space is required.' },
      { status: 400 }
    );
  }

  const userId = await resolveAuthenticatedSupabaseUserId(request);
  if (!userId) {
    return NextResponse.json(
      { message: 'Not authenticated.' },
      { status: 401 }
    );
  }

  const supabase = serviceSupabase();
  if (!supabase) {
    return NextResponse.json(
      { message: 'Supabase service role is not configured.' },
      { status: 500 }
    );
  }

  const { data, error } = await supabase
    .from('space_memberships')
    .select('space_id')
    .eq('user_id', userId)
    .eq('space_id', spaceId)
    .eq('status', 'active')
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      { message: 'Not a member of this space.' },
      { status: 403 }
    );
  }

  const response = NextResponse.json(
    { ok: true },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );

  setCanonicalActiveSpaceCookie(response.cookies, spaceId);
  response.cookies.set(PAYLOAD_TENANT_COOKIE, spaceId, {
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365,
  });

  return response;
}
