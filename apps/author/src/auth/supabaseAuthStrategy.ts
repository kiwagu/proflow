import { decodeJwt } from 'jose';
import type { AuthStrategy, AuthStrategyResult } from 'payload';
import { JWTAuthentication } from 'payload';

import type { Config } from '@/payload-types';
import { hasAuthorAllTenantsCapability } from './critical-capability.server';

import { verifySupabaseAccessToken } from './verifySupabaseAccessToken';

type AuthSlug = keyof Config['auth'];

function isLikelyPayloadJwt(token: string): boolean {
  try {
    const decoded = decodeJwt(token) as Record<string, unknown>;
    return typeof decoded.collection === 'string';
  } catch {
    return false;
  }
}

/**
 * Authenticates requests that send a Supabase access token as `Authorization: Bearer <token>`.
 * Payload-issued JWTs are skipped so `local-jwt` can handle them.
 */
export const supabaseAuthStrategy: AuthStrategy = {
  name: 'supabase-access-token',
  authenticate: async ({ headers, payload, strategyName }) => {
    const authHeader = headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return { user: null };
    }
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token || isLikelyPayloadJwt(token)) {
      return { user: null };
    }

    let claims: { sub: string; email: string };
    try {
      claims = await verifySupabaseAccessToken(token);
    } catch {
      return { user: null };
    }

    const userSlug = payload.config.admin.user as AuthSlug;
    const collection = payload.collections[userSlug];
    if (!collection) {
      return { user: null };
    }

    const { docs } = await payload.find({
      collection: userSlug,
      depth: collection.config.auth.depth,
      limit: 1,
      overrideAccess: true,
      pagination: false,
      where: {
        or: [
          { supabaseSub: { equals: claims.sub } },
          { email: { equals: claims.email } },
        ],
      },
    });

    const doc = docs[0];
    if (!doc) {
      return { user: null };
    }

    const user = doc as typeof doc & {
      collection?: string;
      _strategy?: string;
      hasAuthorAllTenantsCapability?: boolean;
    };
    user.hasAuthorAllTenantsCapability = await hasAuthorAllTenantsCapability(
      claims.sub
    );
    user.collection = userSlug;
    user._strategy = strategyName;
    return {
      user: user as NonNullable<AuthStrategyResult['user']>,
    };
  },
};

/** Payload cookie / JWT auth (required when local password login is disabled). */
export const payloadJwtStrategy: AuthStrategy = {
  name: 'local-jwt',
  authenticate: JWTAuthentication,
};
