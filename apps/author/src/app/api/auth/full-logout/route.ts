import config from '@payload-config';
import { getPayload } from 'payload';
import { generateExpiredPayloadCookie } from 'payload/shared';

import type { Config } from '@/payload-types';

type AuthSlug = keyof Config['auth'];

export async function POST(request: Request) {
  const payload = await getPayload({ config });
  const userSlug = payload.config.admin.user as AuthSlug;
  const usersCollection = payload.collections[userSlug];
  if (!usersCollection) {
    return Response.json(
      { message: 'Admin user collection missing' },
      { status: 500 }
    );
  }

  // Attempt regular Payload logout first (may fail if no active req.user).
  await fetch(new URL('/api/users/logout', request.url), {
    credentials: 'include',
    headers: {
      cookie: request.headers.get('cookie') ?? '',
    },
    method: 'POST',
  }).catch(() => null);

  const expiredCookie = generateExpiredPayloadCookie({
    collectionAuthConfig: usersCollection.config.auth,
    cookiePrefix: payload.config.cookiePrefix,
  });

  const adminRoute = payload.config.routes.admin;
  const loginRoute = `${adminRoute}${payload.config.admin.routes.login}`;

  return Response.json(
    {
      loginHref: loginRoute,
      message: 'Logged out',
    },
    {
      headers: {
        'Cache-Control': 'no-store',
        'Clear-Site-Data': '"storage"',
        'Set-Cookie': expiredCookie,
      },
      status: 200,
    }
  );
}
