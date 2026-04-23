import config from '@payload-config';
import { createLocalReq, getPayload } from 'payload';
import { generatePayloadCookie } from 'payload/shared';
import type { TypedUser } from 'payload';

import { issuePayloadSession } from '@/auth/issuePayloadSession';
import { hasAuthorAllTenantsCapability } from '@/auth/critical-capability.server';
import { syncPayloadUserFromSupabase } from '@/auth/syncPayloadUserFromSupabase';
import { verifySupabaseAccessToken } from '@/auth/verifySupabaseAccessToken';

import type { Config } from '@/payload-types';

type AuthSlug = keyof Config['auth'];

export type EstablishPayloadSessionResult =
  | {
      ok: true;
      setCookieHeader: string;
      exp: number;
      user: TypedUser;
    }
  | { ok: false; status: 400 | 401 | 500; message: string };

/**
 * Validates a Supabase access token and issues a Payload admin session cookie (same as POST
 * `/api/auth/supabase-payload`).
 */
export async function establishPayloadSessionFromAccessToken(
  accessToken: string,
  request: Request
): Promise<EstablishPayloadSessionResult> {
  if (!accessToken) {
    return { ok: false, status: 400, message: 'Missing access_token' };
  }

  const payload = await getPayload({ config });

  let claims: { sub: string; email: string };
  try {
    claims = await verifySupabaseAccessToken(accessToken);
  } catch {
    return { ok: false, status: 401, message: 'Invalid Supabase token' };
  }

  const collectionSlug = payload.config.admin.user as AuthSlug;
  const collection = payload.collections[collectionSlug];
  if (!collection) {
    return {
      ok: false,
      status: 500,
      message: 'Admin user collection missing',
    };
  }

  const req = await createLocalReq(
    {
      req: {
        headers: request.headers,
      },
    },
    payload
  );

  const synced = await syncPayloadUserFromSupabase(
    payload,
    req,
    claims,
    collectionSlug
  );

  const userForSession: TypedUser = {
    ...synced,
    hasAuthorAllTenantsCapability: await hasAuthorAllTenantsCapability(
      claims.sub
    ),
    collection: collectionSlug,
  } as TypedUser;

  const result = await issuePayloadSession({
    payload,
    req,
    collectionSlug,
    user: userForSession,
    email: claims.email,
  });

  const setCookieHeader = generatePayloadCookie({
    collectionAuthConfig: collection.config.auth,
    cookiePrefix: payload.config.cookiePrefix,
    token: result.token,
  });

  return {
    ok: true,
    setCookieHeader,
    exp: result.exp,
    user: result.user,
  };
}
