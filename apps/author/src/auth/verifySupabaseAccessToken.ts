import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';

export type SupabaseJwtClaims = {
  sub: string;
  email: string;
};

function resolveEmailFromClaims(
  payload: Record<string, unknown>
): string | null {
  if (typeof payload.email === 'string' && payload.email.length > 0) {
    return payload.email.toLowerCase().trim();
  }
  const meta = payload.user_metadata;
  if (meta && typeof meta === 'object' && meta !== null) {
    const m = meta as Record<string, unknown>;
    if (typeof m.email === 'string' && m.email.length > 0) {
      return m.email.toLowerCase().trim();
    }
  }
  return null;
}

/**
 * Verifies a Supabase-issued access token (HS256 with JWT secret, or asymmetric via JWKS).
 */
export async function verifySupabaseAccessToken(
  token: string
): Promise<SupabaseJwtClaims> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const jwtSecret = process.env.SUPABASE_JWT_SECRET;

  const decoded = decodeJwt(token);
  const email = resolveEmailFromClaims(decoded as Record<string, unknown>);
  const sub = typeof decoded.sub === 'string' ? decoded.sub : null;
  if (!email || !sub) {
    throw new Error('Supabase token is missing email or sub');
  }

  if (jwtSecret) {
    const secretKey = new TextEncoder().encode(jwtSecret);
    await jwtVerify(token, secretKey, { algorithms: ['HS256'] });
  } else if (supabaseUrl) {
    const jwksUrl = new URL(
      '/auth/v1/.well-known/jwks.json',
      supabaseUrl.endsWith('/') ? supabaseUrl : `${supabaseUrl}/`
    );
    const JWKS = createRemoteJWKSet(jwksUrl);
    await jwtVerify(token, JWKS);
  } else {
    throw new Error(
      'Set SUPABASE_JWT_SECRET (self-hosted) or NEXT_PUBLIC_SUPABASE_URL for JWKS verification'
    );
  }

  return { sub, email };
}
