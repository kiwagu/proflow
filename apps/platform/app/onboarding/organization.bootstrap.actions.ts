'use server';

import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';

import { setCanonicalActiveSpaceCookie } from '@workspace/gateway-auth/active-space.cookie';

import { createClient } from '@/lib/supabase/server';

import {
  organizationBootstrapSchema,
  type OrganizationBootstrapValues,
} from './organization.bootstrap.schema';

function parseBootstrapRpcResult(value: unknown): {
  organizationId: string;
  spaceId: string;
} | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const organizationId = Reflect.get(value, 'organization_id');
  const spaceId = Reflect.get(value, 'space_id');
  if (typeof organizationId !== 'string' || typeof spaceId !== 'string') {
    return null;
  }

  const trimmedOrganizationId = organizationId.trim();
  const trimmedSpaceId = spaceId.trim();
  if (!trimmedOrganizationId || !trimmedSpaceId) {
    return null;
  }

  return {
    organizationId: trimmedOrganizationId,
    spaceId: trimmedSpaceId,
  };
}

export type OrganizationBootstrapResult =
  | { ok: true; organizationId: string; spaceId: string }
  | { ok: false; message: string };

export async function bootstrapOrganizationAction(
  values: OrganizationBootstrapValues
): Promise<OrganizationBootstrapResult> {
  const parsed = organizationBootstrapSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }

  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return { ok: false, message: 'Not authenticated.' };
  }

  const requestId = (await headers()).get('x-request-id') ?? undefined;

  const { data, error } = await supabase.rpc(
    'rpc_bootstrap_organization_and_space',
    {
      p_org_name: parsed.data.orgName.trim(),
      p_org_slug: parsed.data.orgSlug.trim(),
      p_space_name: parsed.data.spaceName.trim(),
      p_space_slug: parsed.data.spaceSlug.trim(),
      p_request_id: requestId,
    }
  );

  if (error) {
    const message =
      process.env.NODE_ENV === 'development'
        ? error.message
        : 'Could not create organization. Please try again.';
    return { ok: false, message };
  }

  const row = parseBootstrapRpcResult(data);
  if (!row) {
    return { ok: false, message: 'Unexpected response from server.' };
  }

  const store = await cookies();
  setCanonicalActiveSpaceCookie(store, row.spaceId);

  revalidatePath('/onboarding');
  revalidatePath('/');
  return {
    ok: true,
    organizationId: row.organizationId,
    spaceId: row.spaceId,
  };
}
