import type { IdentityLifecycleEnvelope } from '@workspace/domain-events';
import type { Payload } from 'payload';

import { AUTHOR_USERS_WRITE_CONTEXT } from '@/collections/users.sync-context';
import type { Config } from '@/payload-types';

type AuthSlug = keyof Config['auth'];

function resolveEmail(body: IdentityLifecycleEnvelope): string {
  const trimmed = body.user.email?.trim();
  if (trimmed) return trimmed;
  return `auth-${body.user.id}@users.noreply.local`;
}

export async function applyIdentityLifecycleEvent(
  payload: Payload,
  body: IdentityLifecycleEnvelope
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const userSlug = payload.config.admin.user as AuthSlug;
  const collection = payload.collections[userSlug];
  if (!collection) {
    return { ok: false, status: 500, message: 'Admin user collection missing' };
  }

  const sub = body.user.id;
  const entityId = body.user.entity_id?.trim() || null;
  const email = resolveEmail(body);

  if (body.event === 'user.deleted') {
    await payload.delete({
      collection: userSlug,
      context: AUTHOR_USERS_WRITE_CONTEXT,
      where: { supabaseSub: { equals: sub } },
      overrideAccess: true,
    });
    return { ok: true };
  }

  if (!entityId) {
    return {
      ok: false,
      status: 400,
      message: 'Missing user.entity_id in identity lifecycle event',
    };
  }

  const { docs } = await payload.find({
    collection: userSlug,
    depth: 0,
    limit: 1,
    overrideAccess: true,
    pagination: false,
    where: {
      or: [{ supabaseSub: { equals: sub } }, { email: { equals: email } }],
    },
  });

  const existing = docs[0] as
    { id: string | number; supabaseSub?: string | null } | undefined;

  if (existing) {
    if (String(existing.id) !== entityId) {
      return {
        ok: false,
        status: 409,
        message: `User id mismatch for supabaseSub=${sub}: existing=${String(
          existing.id
        )} incoming=${entityId}`,
      };
    }
    if (existing.supabaseSub !== sub || body.event === 'user.updated') {
      await payload.update({
        id: existing.id,
        collection: userSlug,
        context: AUTHOR_USERS_WRITE_CONTEXT,
        data: { supabaseSub: sub, email },
        overrideAccess: true,
      });
    }
    return { ok: true };
  }

  await payload.create({
    collection: userSlug,
    context: AUTHOR_USERS_WRITE_CONTEXT,
    data: { id: entityId, email, supabaseSub: sub },
    overrideAccess: true,
  });

  return { ok: true };
}
