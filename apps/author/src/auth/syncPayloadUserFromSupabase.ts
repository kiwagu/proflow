import type { Payload, PayloadRequest, TypedUser } from 'payload';

import { AUTHOR_USERS_WRITE_CONTEXT } from '@/collections/users.sync-context';
import { resolveMirrorEntityId } from '@/identity/mirror-source';
import type { Config } from '@/payload-types';

import type { SupabaseJwtClaims } from './verifySupabaseAccessToken';

type AuthSlug = keyof Config['auth'];

export async function syncPayloadUserFromSupabase(
  payload: Payload,
  req: PayloadRequest,
  claims: SupabaseJwtClaims,
  collectionSlug: AuthSlug
): Promise<TypedUser> {
  const { docs } = await payload.find({
    collection: collectionSlug,
    depth: 0,
    limit: 1,
    overrideAccess: true,
    pagination: false,
    req,
    where: {
      or: [
        { supabaseSub: { equals: claims.sub } },
        { email: { equals: claims.email } },
      ],
    },
  });

  const existing = docs[0] as TypedUser | undefined;

  if (existing) {
    const prevSub = (existing as { supabaseSub?: string | null }).supabaseSub;
    if (prevSub !== claims.sub) {
      await payload.update({
        id: existing.id,
        collection: collectionSlug,
        context: AUTHOR_USERS_WRITE_CONTEXT,
        data: { supabaseSub: claims.sub },
        overrideAccess: true,
        req,
      });
    }
    return payload.findByID({
      collection: collectionSlug,
      depth: 0,
      id: existing.id,
      overrideAccess: true,
      req,
    }) as Promise<TypedUser>;
  }

  // The `users` collection runs `customIdPlugin` in `validate` mode — an id MUST be
  // supplied on create. Use the SAME stable mirror key (`profiles.entity_id`) the
  // JetStream identity worker creates under, so this JIT bridge and the canonical
  // worker never mint divergent ids for the same identity.
  const id = await resolveMirrorEntityId(claims.sub);
  const created = await payload.create({
    collection: collectionSlug,
    context: AUTHOR_USERS_WRITE_CONTEXT,
    data: {
      id,
      email: claims.email,
      supabaseSub: claims.sub,
    },
    overrideAccess: true,
    req,
  });

  return created as TypedUser;
}
