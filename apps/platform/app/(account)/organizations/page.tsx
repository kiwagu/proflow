import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';
import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import { EntityAvatar } from '@workspace/ui/components/entity-avatar';
import { PLATFORM_LOCALE_COOKIE } from '@workspace/settings-runtime';

import { getIsSuperAdminForUser } from '@/lib/platform-nav-roles';
import {
  getCanUserCreateOrganizationSpace,
  getIsOrgAdminForUser,
} from '@/lib/platform-org-admin';
import { getSpaceIdsWhereUserIsSpaceAdmin } from '@/lib/platform-space-admin';
import { createClient } from '@/lib/supabase/server';
import {
  listAccessibleSpacesForUser,
  readActiveSpaceIdFromCookies,
  resolveActiveSpaceIdForAccessibleSpaces,
} from '@/lib/active-space';
import { getServerSpaceSettingsTranslator } from '@/app/(account)/space-settings/space-settings.i18n';
import { cookies, headers } from 'next/headers';
import { resolvePlatformLocaleForSession } from '@/lib/runtime-settings.server';

import { SpaceCreateForm } from './space.create.form';

function getRoleInfo(
  role:
    | { key: string | null; label?: string | null }
    | { key: string | null; label?: string | null }[]
    | null
    | undefined
): { key: string; label: string } | null {
  const row = Array.isArray(role) ? role[0] : role;
  const key =
    typeof row?.key === 'string' && row.key.length > 0 ? row.key : null;
  const label =
    typeof row?.label === 'string' && row.label.trim().length > 0
      ? row.label.trim()
      : null;

  if (!key || !label) {
    return null;
  }

  return { key, label };
}

type SpaceRow = {
  id: string;
  name: string;
  slug: string;
  avatar_url: string | null;
  organization_id: string;
};

type OrgRow = {
  id: string;
  name: string;
  slug: string;
  avatar_url: string | null;
};

function OrganizationsFallback() {
  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <div className="bg-muted/50 h-48 w-full animate-pulse rounded-xl" />
    </div>
  );
}

async function OrganizationsContent() {
  await connection();
  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    redirect('/auth/login');
  }

  const uid = userData.user.id;
  const cookieActiveSpaceId = readActiveSpaceIdFromCookies(await cookies());
  const { spaces: accessibleSpaces } = await listAccessibleSpacesForUser(
    supabase,
    uid
  );
  const activeSpaceId = resolveActiveSpaceIdForAccessibleSpaces(
    accessibleSpaces,
    cookieActiveSpaceId
  );
  const locale = await resolvePlatformLocaleForSession(supabase, {
    acceptLanguage: (await headers()).get('accept-language'),
    localeCookie: (await cookies()).get(PLATFORM_LOCALE_COOKIE)?.value ?? null,
    userId: uid,
    activeSpaceId,
  });
  const t = await getServerSpaceSettingsTranslator(locale);
  const isOrgAdmin = await getIsOrgAdminForUser(supabase, uid);
  const isSuperAdmin = await getIsSuperAdminForUser(supabase, uid);

  const allAdminSpaceIds = await getSpaceIdsWhereUserIsSpaceAdmin(
    supabase,
    uid
  );

  // For space-admin-only users, restrict to the active space only.
  // Org admins and super admins manage by org scope, not active-space scope.
  let adminSpaceIds: string[];
  if (!isOrgAdmin && !isSuperAdmin) {
    adminSpaceIds =
      activeSpaceId && allAdminSpaceIds.includes(activeSpaceId)
        ? [activeSpaceId]
        : [];
  } else {
    adminSpaceIds = allAdminSpaceIds;
  }

  if (!isOrgAdmin && !isSuperAdmin && adminSpaceIds.length === 0) {
    redirect('/profile');
  }

  const orgAdminMemberships = isOrgAdmin
    ? ((
        await supabase
          .from('user_role')
          .select('organization_id, roles!inner(key)')
          .eq('user_id', uid)
          .eq('roles.key', 'org_admin')
      ).data ?? [])
    : [];

  const orgAdminOrgIds = new Set(
    orgAdminMemberships
      .map((row) => row.organization_id)
      .filter((organizationId): organizationId is string =>
        Boolean(organizationId)
      )
  );

  let orgIdsForListing: string[] = [];
  if (isOrgAdmin) {
    orgIdsForListing = [...orgAdminOrgIds];
  } else if (isSuperAdmin && !isOrgAdmin) {
    const { data: allOrgs } = await supabase.from('organizations').select('id');
    orgIdsForListing = allOrgs?.map((o) => o.id).filter(Boolean) ?? [];
  }

  let spaceList: SpaceRow[] = [];
  if (orgIdsForListing.length > 0) {
    const { data: sp } = await supabase
      .from('spaces')
      .select('id,name,slug,avatar_url,organization_id')
      .in('organization_id', orgIdsForListing);
    spaceList = sp ?? [];
  }

  const bySpaceId = new Map(spaceList.map((s) => [s.id, s]));
  for (const sid of adminSpaceIds) {
    if (!bySpaceId.has(sid)) {
      const { data: row } = await supabase
        .from('spaces')
        .select('id,name,slug,avatar_url,organization_id')
        .eq('id', sid)
        .maybeSingle();
      if (row) {
        spaceList.push(row);
        bySpaceId.set(sid, row);
      }
    }
  }

  const orgIdSetForOrgs = new Set(spaceList.map((s) => s.organization_id));
  let orgs: OrgRow[] = [];
  if (orgIdSetForOrgs.size > 0) {
    const { data: orgRows } = await supabase
      .from('organizations')
      .select('id,name,slug,avatar_url')
      .in('id', [...orgIdSetForOrgs])
      .order('name');
    orgs = orgRows ?? [];
  }

  if (orgs.length === 0 && spaceList.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {t('organizations.empty')}
      </p>
    );
  }

  const spacesByOrg = new Map<string, SpaceRow[]>();
  for (const row of spaceList) {
    const list = spacesByOrg.get(row.organization_id) ?? [];
    list.push(row);
    spacesByOrg.set(row.organization_id, list);
  }
  for (const [, list] of spacesByOrg) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  const spaceRolesBySpaceId = new Map<string, Map<string, string>>();
  const orgRolesByOrgId = new Map<string, Map<string, string>>();
  const spaceIds = spaceList.map((s) => s.id);
  const orgIds = [...orgIdSetForOrgs];

  if (spaceIds.length > 0) {
    const { data: spaceRoleRows } = await supabase
      .from('user_role')
      .select('space_id, roles!inner(key,label)')
      .eq('user_id', uid)
      .in('space_id', spaceIds);

    for (const row of spaceRoleRows ?? []) {
      if (!row.space_id) {
        continue;
      }
      const role = getRoleInfo(row.roles);
      if (!role) {
        continue;
      }
      const current =
        spaceRolesBySpaceId.get(row.space_id) ?? new Map<string, string>();
      current.set(role.key, role.label);
      spaceRolesBySpaceId.set(row.space_id, current);
    }
  }

  if (orgIds.length > 0) {
    const { data: orgRoleRows } = await supabase
      .from('user_role')
      .select('organization_id, roles!inner(key,label)')
      .eq('user_id', uid)
      .in('organization_id', orgIds);

    for (const row of orgRoleRows ?? []) {
      if (!row.organization_id) {
        continue;
      }
      const role = getRoleInfo(row.roles);
      if (!role) {
        continue;
      }
      const current =
        orgRolesByOrgId.get(row.organization_id) ?? new Map<string, string>();
      current.set(role.key, role.label);
      orgRolesByOrgId.set(row.organization_id, current);
    }
  }

  let orgAdminOrgOptions: { id: string; name: string; slug: string }[] = [];
  if (isOrgAdmin) {
    const adminOrgIds = [...orgAdminOrgIds];
    if (adminOrgIds.length > 0) {
      const { data: adminOrgs } = await supabase
        .from('organizations')
        .select('id,name,slug')
        .in('id', adminOrgIds)
        .order('name');
      orgAdminOrgOptions = adminOrgs ?? [];
    }
  }
  const canCreateSpace =
    (await getCanUserCreateOrganizationSpace(supabase, uid)) &&
    orgAdminOrgOptions.length > 0;

  const subtitle =
    isSuperAdmin && !isOrgAdmin
      ? t('organizations.subtitle.superAdmin')
      : isOrgAdmin
        ? t('organizations.subtitle.orgAdmin')
        : t('organizations.subtitle.spaceAdminOnly');

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('organizations.title')}
        </h1>
        <p className="text-muted-foreground text-sm">{subtitle}</p>
      </div>
      <div className="flex flex-col gap-4">
        {(orgs ?? []).map((org) => {
          const orgRoles = [...(orgRolesByOrgId.get(org.id) ?? new Map())]
            .map(([key, label]) => ({ key, label }))
            .sort((a, b) => a.label.localeCompare(b.label));
          return (
            <Card key={org.id}>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <EntityAvatar
                    name={org.name}
                    avatarUrl={org.avatar_url}
                    className="size-8"
                  />
                  <CardTitle>{org.name}</CardTitle>
                </div>
                <CardDescription>
                  {t('organizations.slug', { slug: org.slug })}
                </CardDescription>
                {isOrgAdmin || isSuperAdmin ? (
                  <CardAction>
                    <Button asChild size="sm" variant="outline">
                      <Link
                        href={`/organizations/${org.id}/settings`}
                        data-testid={`organization-settings-link-${org.id}`}
                      >
                        {t('organizations.actions.settings')}
                      </Link>
                    </Button>
                  </CardAction>
                ) : null}
                {orgRoles.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {orgRoles.map((role) => (
                      <Badge
                        key={`org-${org.id}-${role.key}`}
                        variant="secondary"
                        className="text-[11px]"
                      >
                        {role.label}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-2 text-xs font-medium uppercase">
                  {t('organizations.sections.spaces')}
                </p>
                <ul className="flex flex-col gap-4">
                  {(spacesByOrg.get(org.id) ?? []).length === 0 ? (
                    <li className="text-muted-foreground text-sm">
                      {t('organizations.emptySpaces')}
                    </li>
                  ) : (
                    (spacesByOrg.get(org.id) ?? []).map((s) => {
                      const spaceRoles = [
                        ...(spaceRolesBySpaceId.get(s.id) ?? new Map()),
                      ]
                        .map(([key, label]) => ({ key, label }))
                        .sort((a, b) => a.label.localeCompare(b.label));
                      return (
                        <li
                          key={s.id}
                          className="border-border flex min-w-0 flex-col gap-1 rounded-md border p-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <EntityAvatar
                                name={s.name}
                                avatarUrl={s.avatar_url}
                                className="size-6"
                                fallbackClassName="text-[10px]"
                              />
                              <span className="truncate font-medium">
                                {s.name}
                              </span>
                            </div>
                            {activeSpaceId === s.id ? (
                              <span className="text-muted-foreground text-xs">
                                {t('organizations.status.active')}
                              </span>
                            ) : null}
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-muted-foreground text-xs">
                              {s.slug}
                            </span>
                          </div>
                          {spaceRoles.length > 0 ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {spaceRoles.map((role) => (
                                <Badge
                                  key={`${s.id}-${role.key}`}
                                  variant="secondary"
                                  className="text-[11px]"
                                >
                                  {role.label}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                        </li>
                      );
                    })
                  )}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('organizations.spaceAdministration.title')}</CardTitle>
          <CardDescription>
            {t('organizations.spaceAdministration.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            {t('organizations.spaceAdministration.bodyPrefix')}{' '}
            <Link href="/space-settings" className="underline">
              {t('spaceSettings.title')}
            </Link>{' '}
            {t('organizations.spaceAdministration.bodySuffix')}
          </p>
        </CardContent>
      </Card>
      {canCreateSpace ? (
        <Card data-testid="organizations-create-space-card">
          <CardHeader>
            <CardTitle>{t('organizations.createSpace.title')}</CardTitle>
            <CardDescription>
              {t('organizations.createSpace.description')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SpaceCreateForm orgOptions={orgAdminOrgOptions} locale={locale} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default function OrganizationsPage() {
  return (
    <Suspense fallback={<OrganizationsFallback />}>
      <OrganizationsContent />
    </Suspense>
  );
}
