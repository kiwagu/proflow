import 'server-only';

import { connection } from 'next/server';
import { Suspense } from 'react';
import { headers } from 'next/headers';

import { NavUserWithLogout } from '@/components/nav-user-with-logout';
import { AuthButton } from '@/components/auth-button';
import { PlatformShellLayout } from '@/components/platform.shell.client';
import { getCanUserCreateOrganizationSpace } from '@/lib/platform-org-admin';
import {
  getShowOrganizationsNav,
  getShowSpaceSettingsNav,
} from '@/lib/platform-nav-roles';
import { loadPendingSpaceInvitesForUser } from '@/lib/space-invite.pending.server';
import {
  listAccessibleSpacesForUser,
  readActiveSpaceIdFromCookies,
  resolveActiveSpaceIdForAccessibleSpaces,
} from '@/lib/active-space';
import { ensureInitialPlatformSuperAdminForUser } from '@/lib/super-admin.bootstrap.server';
import { createClient } from '@/lib/supabase/server';
import {
  getSpaceSettingsTranslator,
  initializeSpaceSettingsMessages,
  resolveSpaceSettingsLocale,
} from '@/app/(account)/space-settings/space-settings.i18n';
import { cookies } from 'next/headers';
import { PLATFORM_LOCALE_COOKIE } from '@workspace/settings-runtime';
import {
  applyPlatformRuntimeLogLevel,
  resolvePlatformLocaleForSession,
} from '@/lib/runtime-settings.server';

/**
 * Server-only shell: keep `createClient` / `next/headers` out of `layout.tsx` so the
 * client boundary (PlatformShellLayout) does not pull `supabase-server` into the browser bundle.
 */
export async function AccountShellWithNav({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();
  await applyPlatformRuntimeLogLevel();
  const supabase = await createClient();
  const acceptLanguage = (await headers()).get('accept-language');
  const localeCookie = (await cookies()).get(PLATFORM_LOCALE_COOKIE)?.value;
  let locale = resolveSpaceSettingsLocale(acceptLanguage);
  const { data: userData } = await supabase.auth.getUser();
  let showOrganizationsNav = false;
  let showSpaceSettingsNav = false;
  let showSuperAdminNav = false;
  let canCreateOrganizationSpace = false;
  let activeSpaceId: string | null = null;
  let spaces: Array<{
    id: string;
    name: string;
    slug: string;
    avatarUrl: string | null;
  }> = [];
  let superAdminCurrentOrganization: {
    id: string;
    name: string;
    slug: string;
  } | null = null;
  let pendingSpaceInvites: Awaited<
    ReturnType<typeof loadPendingSpaceInvitesForUser>
  > = [];
  let userProfile: { name: string; email: string; avatar: string } | null =
    null;

  if (userData.user) {
    await ensureInitialPlatformSuperAdminForUser(supabase, userData.user);

    const uid = userData.user.id;
    const cookieActiveSpaceId = readActiveSpaceIdFromCookies(await cookies());

    const { data: profileRow } = await supabase
      .from('profiles')
      .select('display_name, email, avatar_url')
      .eq('user_id', uid)
      .maybeSingle();

    userProfile = {
      name: profileRow?.display_name || userData.user.email || '',
      email: profileRow?.email || userData.user.email || '',
      avatar: profileRow?.avatar_url || '',
    };

    canCreateOrganizationSpace = await getCanUserCreateOrganizationSpace(
      supabase,
      uid
    );

    const accessibleSpaces = await listAccessibleSpacesForUser(supabase, uid);
    activeSpaceId = resolveActiveSpaceIdForAccessibleSpaces(
      accessibleSpaces.spaces,
      cookieActiveSpaceId
    );
    const activeSpace =
      accessibleSpaces.spaces.find((space) => space.id === activeSpaceId) ??
      null;

    if (accessibleSpaces.isSuperAdmin && activeSpace) {
      const { data: organizationRow } = await supabase
        .from('organizations')
        .select('id,name,slug')
        .eq('id', activeSpace.organizationId)
        .maybeSingle();

      if (organizationRow) {
        superAdminCurrentOrganization = {
          id: organizationRow.id,
          name: organizationRow.name,
          slug: organizationRow.slug,
        };
      }
    }

    const visibleSpaces =
      accessibleSpaces.isSuperAdmin && activeSpace
        ? accessibleSpaces.spaces.filter(
            (space) => space.organizationId === activeSpace.organizationId
          )
        : accessibleSpaces.spaces;

    spaces = visibleSpaces.map((space) => ({
      id: space.id,
      name: space.name,
      slug: space.slug,
      avatarUrl: space.avatarUrl,
    }));

    showOrganizationsNav = await getShowOrganizationsNav(
      supabase,
      uid,
      activeSpaceId
    );
    showSpaceSettingsNav = await getShowSpaceSettingsNav(
      supabase,
      uid,
      activeSpaceId
    );
    showSuperAdminNav = accessibleSpaces.isSuperAdmin;

    locale = await resolvePlatformLocaleForSession(supabase, {
      acceptLanguage,
      localeCookie,
      userId: uid,
      activeSpaceId,
    });

    pendingSpaceInvites = await loadPendingSpaceInvitesForUser(
      supabase,
      userData.user
    );
  }

  const spaceSettingsMessages = await initializeSpaceSettingsMessages(locale);
  const t = getSpaceSettingsTranslator(locale);

  return (
    <PlatformShellLayout
      headerAuth={
        <Suspense>
          {userProfile ? (
            <NavUserWithLogout user={userProfile} />
          ) : (
            <AuthButton />
          )}
        </Suspense>
      }
      showOrganizationsNav={showOrganizationsNav}
      showSpaceSettingsNav={showSpaceSettingsNav}
      showSuperAdminNav={showSuperAdminNav}
      canCreateOrganizationSpace={canCreateOrganizationSpace}
      activeSpaceId={activeSpaceId}
      spaces={spaces}
      superAdminCurrentOrganization={superAdminCurrentOrganization}
      pendingSpaceInvites={pendingSpaceInvites}
      spaceSettingsMessages={spaceSettingsMessages}
      navLabels={{
        profile: t('shell.nav.profile'),
        spaceSettings: t('shell.nav.spaceSettings'),
        organizations: t('shell.nav.organizations'),
        superAdmin: t('shell.nav.superAdmin'),
        appTitle: t('shell.appTitle'),
        activeOrganization: t('shell.superAdmin.activeOrganization'),
        noActiveOrganization: t('shell.superAdmin.noActiveOrganization'),
      }}
    >
      {children}
    </PlatformShellLayout>
  );
}
