'use client';

import { usePathname } from 'next/navigation';

import { EnvVarWarning } from '@/components/env-var-warning';
import type { PlatformPendingSpaceInvite } from '@/lib/platform-shell.types';
import { PlatformSpaceSwitcher } from '@/components/platform-space-switcher.client';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { PLATFORM_OPERATOR_CONSOLE_PATH } from '@/lib/platform-routes';
import { hasEnvVars } from '@/lib/utils';
import { cn } from '@workspace/ui/lib/utils';
import { Hint } from '@workspace/ui/components/hint';
import { pathWithinAppBasePath } from '@workspace/gateway-auth/path-within-base';
import { getAppBasePath } from '@workspace/gateway-auth/gateway-paths';
import { ActiveSpaceProvider } from '@/lib/active-space.context.client';
import {
  primeSpaceSettingsMessages,
  type PreloadedSpaceSettingsMessages,
} from '@/app/(account)/space-settings/space-settings.i18n';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@workspace/ui/components/sidebar';
import { Building2, Settings2, Shield, User } from 'lucide-react';
import Link from 'next/link';

const PLATFORM_BASE = getAppBasePath('/platform');

type PlatformShellLayoutProps = {
  children: React.ReactNode;
  /** Server-rendered auth menu; must not be imported here (avoids bundling `next/headers`). */
  headerAuth: React.ReactNode;
  /** Org admins and platform super admins: link to organization / Space overview. */
  showOrganizationsNav: boolean;
  /** Users with active-space admin access: link to active-space settings. */
  showSpaceSettingsNav: boolean;
  /** Critical-capability users: dedicated super-admin contour. */
  showSuperAdminNav: boolean;
  /** Only org admins: show Create Space in the workspace switcher. */
  canCreateOrganizationSpace: boolean;
  /** Active Space id (from cookie, server-computed). */
  activeSpaceId: string | null;
  /** Available Spaces for the current user (server-computed). */
  spaces: ReadonlyArray<{
    id: string;
    name: string;
    slug: string;
    avatarUrl: string | null;
  }>;
  /** Current active organization metadata for super-admin tooling hooks. */
  superAdminCurrentOrganization: Readonly<{
    id: string;
    name: string;
    slug: string;
  }> | null;
  /** Pending invites for the signed-in user email (server-computed). */
  pendingSpaceInvites: readonly PlatformPendingSpaceInvite[];
  navLabels: Readonly<{
    profile: string;
    spaceSettings: string;
    organizations: string;
    superAdmin: string;
    toggleSidebar: string;
    appTitle: string;
    activeOrganization: string;
    noActiveOrganization: string;
  }>;
  spaceSettingsMessages: PreloadedSpaceSettingsMessages;
};

export function PlatformShellLayout({
  children,
  headerAuth,
  showOrganizationsNav,
  showSpaceSettingsNav,
  showSuperAdminNav,
  canCreateOrganizationSpace,
  activeSpaceId,
  spaces,
  superAdminCurrentOrganization,
  pendingSpaceInvites,
  navLabels,
  spaceSettingsMessages,
}: PlatformShellLayoutProps) {
  primeSpaceSettingsMessages(spaceSettingsMessages);

  const pathname = usePathname();
  const pathWithin = pathWithinAppBasePath(pathname, PLATFORM_BASE);

  const isProfile =
    pathWithin === '/profile' || pathWithin.startsWith('/profile/');
  const isOrganizations = pathWithin.startsWith('/organizations');
  const isSpaceSettings = pathWithin.startsWith('/space-settings');
  const isSuperAdmin = pathWithin.startsWith(PLATFORM_OPERATOR_CONSOLE_PATH);
  const navItems: Array<{
    key: 'profile' | 'space-settings' | 'organizations' | 'super-admin';
    href:
      | '/profile'
      | '/space-settings'
      | '/organizations'
      | typeof PLATFORM_OPERATOR_CONSOLE_PATH;
    label: string;
    isActive: boolean;
    visible: boolean;
    icon: typeof User;
  }> = [
    {
      key: 'profile',
      href: '/profile',
      label: navLabels.profile,
      isActive: isProfile,
      visible: true,
      icon: User,
    },
    {
      key: 'space-settings',
      href: '/space-settings',
      label: navLabels.spaceSettings,
      isActive: isSpaceSettings,
      visible: showSpaceSettingsNav,
      icon: Settings2,
    },
    {
      key: 'organizations',
      href: '/organizations',
      label: navLabels.organizations,
      isActive: isOrganizations,
      visible: showOrganizationsNav,
      icon: Building2,
    },
    {
      key: 'super-admin',
      href: PLATFORM_OPERATOR_CONSOLE_PATH,
      label: navLabels.superAdmin,
      isActive: isSuperAdmin,
      visible: showSuperAdminNav,
      icon: Shield,
    },
  ];

  return (
    <ActiveSpaceProvider activeSpaceId={activeSpaceId}>
      <SidebarProvider defaultOpen>
        <Sidebar collapsible="icon" variant="inset">
          <SidebarHeader>
            <PlatformSpaceSwitcher
              activeSpaceId={activeSpaceId}
              spaces={spaces}
              canCreateOrganizationSpace={canCreateOrganizationSpace}
              pendingSpaceInvites={pendingSpaceInvites}
            />
          </SidebarHeader>
          <SidebarContent>
            <SidebarMenu>
              {navItems
                .filter((item) => item.visible)
                .map((item) => {
                  const Icon = item.icon;
                  return (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton
                        asChild
                        isActive={item.isActive}
                        tooltip={item.label}
                      >
                        <Link href={item.href} prefetch={false}>
                          <Icon data-icon="inline-start" />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
            </SidebarMenu>
          </SidebarContent>
          <SidebarFooter>
            <div className="flex items-center justify-between gap-3 px-2">
              <ThemeSwitcher />
            </div>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>

        <SidebarInset>
          <header className="border-border flex h-14 w-full shrink-0 items-center border-b">
            <div className="flex flex-1 items-center justify-between gap-4 px-4 text-sm">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Hint label={navLabels.toggleSidebar} side="bottom">
                  <SidebarTrigger />
                </Hint>
                <Link
                  href="/"
                  className={cn('font-semibold hover:underline')}
                  prefetch={false}
                >
                  {navLabels.appTitle}
                </Link>
                {showSuperAdminNav ? (
                  <div
                    className="bg-muted text-foreground inline-flex max-w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-xs"
                    data-testid="platform-super-admin-current-organization-indicator"
                    data-current-organization-id={
                      superAdminCurrentOrganization?.id ?? ''
                    }
                    data-current-organization-name={
                      superAdminCurrentOrganization?.name ?? ''
                    }
                    data-current-organization-slug={
                      superAdminCurrentOrganization?.slug ?? ''
                    }
                  >
                    <span className="text-muted-foreground shrink-0">
                      {navLabels.activeOrganization}
                    </span>
                    <span className="truncate font-medium">
                      {superAdminCurrentOrganization?.name ??
                        navLabels.noActiveOrganization}
                    </span>
                    {superAdminCurrentOrganization?.slug ? (
                      <span className="text-muted-foreground truncate">
                        {superAdminCurrentOrganization.slug}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {!hasEnvVars ? <EnvVarWarning /> : headerAuth}
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-5 md:p-6">
              {children}
            </div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </ActiveSpaceProvider>
  );
}
