'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@workspace/ui/components/sidebar';
import { EntityAvatar } from '@workspace/ui/components/entity-avatar';
import { ChevronsUpDownIcon, PlusIcon } from 'lucide-react';

import type { PlatformPendingSpaceInvite } from '@/lib/platform-shell.types';
import type { AcceptSpaceInviteResult } from '@/lib/space-invite.accept.actions';
import { acceptSpaceInviteAction } from '@/lib/space-invite.accept.actions';
import type { SetActiveSpaceResult } from '@/lib/space.active.actions';
import { setActiveSpaceAction } from '@/lib/space.active.actions';

type PlatformSpaceSwitcherProps = Readonly<{
  activeSpaceId: string | null;
  spaces: ReadonlyArray<{
    id: string;
    name: string;
    slug: string;
    avatarUrl: string | null;
  }>;
  canCreateOrganizationSpace: boolean;
  pendingSpaceInvites: readonly PlatformPendingSpaceInvite[];
}>;

export function PlatformSpaceSwitcher({
  activeSpaceId,
  spaces,
  canCreateOrganizationSpace,
  pendingSpaceInvites,
}: PlatformSpaceSwitcherProps) {
  const { isMobile } = useSidebar();
  const router = useRouter();
  const active = spaces.find((s) => s.id === activeSpaceId) ?? null;
  const activeLabel = active
    ? `${active.name} (${active.slug})`
    : 'Choose a Space';

  const isReadOnly =
    spaces.length <= 1 &&
    pendingSpaceInvites.length === 0 &&
    !canCreateOrganizationSpace;

  const buttonContent = (
    <>
      <EntityAvatar
        name={active?.name ?? 'Workspace'}
        avatarUrl={active?.avatarUrl ?? null}
        className="size-8"
      />
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">Workspace</span>
        <span className="text-muted-foreground truncate text-xs">
          {activeLabel}
        </span>
      </div>
    </>
  );

  if (isReadOnly) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="lg"
            tooltip="Workspace"
            className="cursor-default"
          >
            {buttonContent}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              tooltip="Workspace"
              data-testid="platform-space-switcher-trigger"
            >
              {buttonContent}
              <ChevronsUpDownIcon className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            align="start"
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
          >
            {pendingSpaceInvites.length > 0 ? (
              <>
                <DropdownMenuLabel className="text-muted-foreground text-xs">
                  Invitations
                </DropdownMenuLabel>
                {pendingSpaceInvites.map((inv) => (
                  <DropdownMenuItem
                    key={inv.id}
                    className="flex flex-col items-start gap-1 p-2"
                    onSelect={() => {
                      void (async () => {
                        const result: AcceptSpaceInviteResult =
                          await acceptSpaceInviteAction(inv.token);
                        if (!result.ok) return;
                        router.refresh();
                      })();
                    }}
                  >
                    <span className="font-medium">
                      {inv.spaceName}
                      {inv.spaceSlug ? (
                        <span className="text-muted-foreground font-normal">
                          {' '}
                          ({inv.spaceSlug})
                        </span>
                      ) : null}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      Role: {inv.roleLabel} · Accept to join
                    </span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            ) : null}

            <DropdownMenuLabel className="text-muted-foreground text-xs">
              Spaces
            </DropdownMenuLabel>
            {spaces.length === 0 ? (
              <DropdownMenuItem disabled className="p-2">
                No spaces yet
              </DropdownMenuItem>
            ) : (
              spaces.map((s) => (
                <DropdownMenuItem
                  key={s.id}
                  className="gap-2 p-2"
                  data-testid={`platform-space-switcher-option-${s.id}`}
                  onSelect={() => {
                    void (async () => {
                      const result: SetActiveSpaceResult =
                        await setActiveSpaceAction(s.id);
                      if (!result.ok) return;
                      router.refresh();
                    })();
                  }}
                >
                  <EntityAvatar
                    name={s.name}
                    avatarUrl={s.avatarUrl}
                    className="size-6"
                    fallbackClassName="text-[10px]"
                  />
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{s.name}</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {s.slug}
                    </span>
                  </div>
                  {activeSpaceId === s.id ? (
                    <span className="text-muted-foreground text-xs">
                      Active
                    </span>
                  ) : null}
                </DropdownMenuItem>
              ))
            )}
            {canCreateOrganizationSpace ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="gap-2 p-2"
                  onSelect={() => router.push('/organizations')}
                >
                  <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                    <PlusIcon className="size-4" />
                  </div>
                  <div className="text-muted-foreground font-medium">
                    Create Space
                  </div>
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
