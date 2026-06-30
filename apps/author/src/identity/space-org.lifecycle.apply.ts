import type { SpaceOrgLifecycleEnvelope } from '@workspace/domain-events';
import type { Payload } from 'payload';

import { AUTHOR_USERS_WRITE_CONTEXT } from '@/collections/users.sync-context';
import { AUTHOR_SPACE_ORG_WRITE_CONTEXT } from '@/collections/space-org.sync-context';
import { serviceSupabaseClient } from '@/identity/mirror-source';
import type { Config } from '@/payload-types';

type AuthSlug = keyof Config['auth'];

type TenantRow = { tenant: string };
type AuthorUserDoc = {
  id: string | number;
  email?: string | null;
  supabaseSub?: string | null;
};

type SyncUserResult =
  | { ok: true; recovered: boolean }
  | { ok: false; status: number; message: string };

function tenantRowsFromUserDoc(doc: unknown): TenantRow[] {
  const u = doc as { tenants?: TenantRow[] | null };
  return Array.isArray(u.tenants) ? u.tenants : [];
}

function fallbackEmailForUserId(userId: string): string {
  return `auth-${userId}@users.noreply.local`;
}

async function syncAuthorUserFromSupabase(
  payload: Payload,
  userSlug: AuthSlug,
  userId: string
): Promise<SyncUserResult> {
  const supabase = serviceSupabaseClient();
  if (!supabase) {
    return {
      ok: false,
      status: 500,
      message:
        'SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL is missing',
    };
  }

  const { data: authUserData, error: authUserError } =
    await supabase.auth.admin.getUserById(userId);
  if (authUserError || !authUserData.user) {
    return {
      ok: false,
      status: 404,
      message: `No auth.users row for supabaseSub=${userId}`,
    };
  }

  const { data: profileRow, error: profileError } = await supabase
    .from('profiles')
    .select('entity_id,email')
    .eq('user_id', userId)
    .maybeSingle<{ entity_id: string | null; email: string | null }>();

  if (profileError || !profileRow?.entity_id?.trim()) {
    return {
      ok: false,
      status: 409,
      message: `Inconsistent mirror source for supabaseSub=${userId}: missing profiles.entity_id`,
    };
  }

  const entityId = profileRow.entity_id.trim();
  const email =
    profileRow.email?.trim() ||
    authUserData.user.email?.trim() ||
    fallbackEmailForUserId(userId);

  const { docs } = await payload.find({
    collection: userSlug,
    depth: 0,
    limit: 1,
    overrideAccess: true,
    pagination: false,
    where: {
      or: [
        { id: { equals: entityId } },
        { supabaseSub: { equals: userId } },
        { email: { equals: email } },
      ],
    },
  });

  const existing = docs[0] as AuthorUserDoc | undefined;
  if (existing) {
    if (
      existing.supabaseSub?.trim() === userId &&
      String(existing.id) !== entityId
    ) {
      return {
        ok: false,
        status: 409,
        message: `Inconsistent mirror mapping for supabaseSub=${userId}: existing=${String(
          existing.id
        )} expected=${entityId}`,
      };
    }

    await payload.update({
      id: existing.id,
      collection: userSlug,
      context: AUTHOR_USERS_WRITE_CONTEXT,
      data: { supabaseSub: userId, email },
      overrideAccess: true,
    });

    return { ok: true, recovered: true };
  }

  await payload.create({
    collection: userSlug,
    context: AUTHOR_USERS_WRITE_CONTEXT,
    data: { id: entityId, email, supabaseSub: userId },
    overrideAccess: true,
  });

  return { ok: true, recovered: true };
}

export async function applySpaceOrgLifecycleEvent(
  payload: Payload,
  body: SpaceOrgLifecycleEnvelope
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const userSlug = payload.config.admin.user as AuthSlug;

  switch (body.event) {
    case 'organization.created':
    case 'organization.updated': {
      const o = body.organization;
      const { docs } = await payload.find({
        collection: 'organizations',
        depth: 0,
        limit: 1,
        overrideAccess: true,
        pagination: false,
        where: { id: { equals: o.id } },
      });
      const existing = docs[0];
      if (existing) {
        await payload.update({
          id: existing.id,
          collection: 'organizations',
          context: AUTHOR_SPACE_ORG_WRITE_CONTEXT,
          data: { name: o.name, slug: o.slug },
          overrideAccess: true,
        });
      } else {
        await payload.create({
          collection: 'organizations',
          context: AUTHOR_SPACE_ORG_WRITE_CONTEXT,
          data: { id: o.id, name: o.name, slug: o.slug },
          overrideAccess: true,
        });
      }
      return { ok: true };
    }
    case 'organization.deleted': {
      await payload.delete({
        collection: 'organizations',
        context: AUTHOR_SPACE_ORG_WRITE_CONTEXT,
        where: { id: { equals: body.organization.id } },
        overrideAccess: true,
      });
      return { ok: true };
    }
    case 'space.created':
    case 'space.updated': {
      const s = body.space;
      const { docs } = await payload.find({
        collection: 'spaces',
        depth: 0,
        limit: 1,
        overrideAccess: true,
        pagination: false,
        where: { id: { equals: s.id } },
      });
      const existing = docs[0];
      if (existing) {
        await payload.update({
          id: existing.id,
          collection: 'spaces',
          context: AUTHOR_SPACE_ORG_WRITE_CONTEXT,
          data: {
            name: s.name,
            slug: s.slug,
            organization: s.organization_id,
          },
          overrideAccess: true,
        });
      } else {
        await payload.create({
          collection: 'spaces',
          context: AUTHOR_SPACE_ORG_WRITE_CONTEXT,
          data: {
            id: s.id,
            name: s.name,
            slug: s.slug,
            organization: s.organization_id,
          },
          overrideAccess: true,
        });
      }
      return { ok: true };
    }
    case 'space.deleted': {
      await payload.delete({
        collection: 'spaces',
        context: AUTHOR_SPACE_ORG_WRITE_CONTEXT,
        where: { id: { equals: body.space.id } },
        overrideAccess: true,
      });
      return { ok: true };
    }
    case 'space_membership.created':
    case 'space_membership.updated':
      return upsertMembership(
        payload,
        userSlug,
        body.membership.space_id,
        body.membership.user_id,
        body.membership.status
      );
    case 'space_membership.deleted':
      return removeMembership(
        payload,
        userSlug,
        body.membership.space_id,
        body.membership.user_id
      );
  }
}

async function upsertMembership(
  payload: Payload,
  userSlug: AuthSlug,
  spaceId: string,
  userId: string,
  status: string
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (status !== 'active') {
    return removeMembership(payload, userSlug, spaceId, userId);
  }

  const { docs } = await payload.find({
    collection: userSlug,
    depth: 0,
    limit: 1,
    overrideAccess: true,
    pagination: false,
    where: { supabaseSub: { equals: userId } },
  });

  const doc = docs[0] as { id: string | number } | undefined;
  if (!doc) {
    const syncResult = await syncAuthorUserFromSupabase(
      payload,
      userSlug,
      userId
    );
    if (!syncResult.ok) {
      return {
        ok: false,
        status: syncResult.status,
        message: syncResult.message,
      };
    }

    if (syncResult.recovered) {
      console.warn(
        `space-org.lifecycle.apply: recovered missing mirror user for supabaseSub=${userId}`
      );
    }

    const { docs: syncedDocs } = await payload.find({
      collection: userSlug,
      depth: 0,
      limit: 1,
      overrideAccess: true,
      pagination: false,
      where: { supabaseSub: { equals: userId } },
    });
    const syncedDoc = syncedDocs[0] as { id: string | number } | undefined;
    if (!syncedDoc) {
      return {
        ok: false,
        status: 404,
        message: `No user for supabaseSub=${userId}`,
      };
    }

    const current = await payload.findByID({
      collection: userSlug,
      id: syncedDoc.id,
      depth: 0,
      overrideAccess: true,
    });

    const rows = tenantRowsFromUserDoc(current);
    const without = rows.filter((r) => r.tenant !== spaceId);
    const next: TenantRow[] = [...without, { tenant: spaceId }];

    await payload.update({
      id: syncedDoc.id,
      collection: userSlug,
      context: AUTHOR_USERS_WRITE_CONTEXT,
      data: { tenants: next },
      overrideAccess: true,
    });

    return { ok: true };
  }

  const current = await payload.findByID({
    collection: userSlug,
    id: doc.id,
    depth: 0,
    overrideAccess: true,
  });

  const rows = tenantRowsFromUserDoc(current);
  const without = rows.filter((r) => r.tenant !== spaceId);
  const next: TenantRow[] = [...without, { tenant: spaceId }];

  await payload.update({
    id: doc.id,
    collection: userSlug,
    context: AUTHOR_USERS_WRITE_CONTEXT,
    data: { tenants: next },
    overrideAccess: true,
  });

  return { ok: true };
}

async function removeMembership(
  payload: Payload,
  userSlug: AuthSlug,
  spaceId: string,
  userId: string
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const { docs } = await payload.find({
    collection: userSlug,
    depth: 0,
    limit: 1,
    overrideAccess: true,
    pagination: false,
    where: { supabaseSub: { equals: userId } },
  });

  const doc = docs[0] as { id: string | number } | undefined;
  if (!doc) {
    return { ok: true };
  }

  const current = await payload.findByID({
    collection: userSlug,
    id: doc.id,
    depth: 0,
    overrideAccess: true,
  });

  const rows = tenantRowsFromUserDoc(current);
  const next = rows.filter((r) => r.tenant !== spaceId);

  await payload.update({
    id: doc.id,
    collection: userSlug,
    context: AUTHOR_USERS_WRITE_CONTEXT,
    data: { tenants: next },
    overrideAccess: true,
  });

  return { ok: true };
}
