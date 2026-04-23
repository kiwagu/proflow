import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { createLocalReq, getPayload } from 'payload';
import { generatePayloadCookie } from 'payload/shared';

import { issuePayloadSession } from '../../src/auth/issuePayloadSession';
import config from '../../src/payload.config.js';

export interface LoginOptions {
  page: Page;
  serverURL?: string;
  user: {
    email: string;
  };
}

function hostFromServerURL(serverURL: string): string {
  try {
    return new URL(serverURL).hostname;
  } catch {
    return 'localhost';
  }
}

/**
 * Opens an authenticated admin session by issuing a Payload JWT (same as Supabase login flow, without Supabase).
 */
function cookiePathFromServerURL(serverURL: string): string {
  try {
    const pathname = new URL(serverURL).pathname.replace(/\/$/, '');
    return pathname === '' ? '/' : pathname;
  } catch {
    return '/';
  }
}

export async function login({
  page,
  serverURL = 'http://localhost:3002/author',
  user,
}: LoginOptions): Promise<void> {
  const payload = await getPayload({ config });
  const req = await createLocalReq(
    {
      req: {
        headers: new Headers(),
      },
    },
    payload
  );

  const { docs } = await payload.find({
    collection: 'users',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    pagination: false,
    req,
    where: {
      email: {
        equals: user.email,
      },
    },
  });

  const doc = docs[0];
  if (!doc) {
    throw new Error(`No Payload user for ${user.email}`);
  }

  const collectionSlug = payload.config.admin.user as 'users';
  const userForSession = {
    ...doc,
    collection: collectionSlug,
  };

  const result = await issuePayloadSession({
    collectionSlug,
    email: user.email,
    payload,
    req,
    user: userForSession,
  });

  const usersCollection = payload.collections[collectionSlug];
  if (!usersCollection) {
    throw new Error('Users collection missing');
  }

  const cookieHeader = generatePayloadCookie({
    collectionAuthConfig: usersCollection.config.auth,
    cookiePrefix: payload.config.cookiePrefix,
    token: result.token,
  });

  const eq = cookieHeader.indexOf('=');
  if (eq < 0) {
    throw new Error('Failed to parse Payload session cookie');
  }
  const name = cookieHeader.slice(0, eq);
  const rest = cookieHeader.slice(eq + 1);
  const semi = rest.indexOf(';');
  const value = semi === -1 ? rest : rest.slice(0, semi);

  const host = hostFromServerURL(serverURL);
  const cookiePath = cookiePathFromServerURL(serverURL);
  await page.context().addCookies([
    {
      domain: host === 'localhost' ? 'localhost' : host,
      httpOnly: true,
      name,
      path: cookiePath,
      sameSite: 'Lax',
      value,
    },
  ]);

  await page.goto(`${serverURL}/admin`);

  const dashboardArtifact = page.locator('span[title="Dashboard"]');
  await expect(dashboardArtifact).toBeVisible();
}
