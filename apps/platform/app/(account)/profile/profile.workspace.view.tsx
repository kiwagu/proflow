import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';
import { Badge } from '@workspace/ui/components/badge';
import { EntityAvatar } from '@workspace/ui/components/entity-avatar';

import type { ProfileWorkspaceContext } from '@/lib/profile-workspace-context';
import type { PlatformPendingSpaceInvite } from '@/lib/platform-shell.types';

import { ProfileWorkspaceInvitesClient } from './profile.workspace.invites.client';

type ProfileWorkspaceViewProps = {
  workspace: ProfileWorkspaceContext;
  pendingSpaceInvites: readonly PlatformPendingSpaceInvite[];
};

export function ProfileWorkspaceView({
  workspace,
  pendingSpaceInvites,
}: ProfileWorkspaceViewProps) {
  if (workspace.kind === 'empty') {
    return (
      <div className="flex flex-col gap-4">
        <Card data-testid="profile-workspace-card">
          <CardHeader>
            <CardTitle className="text-xl">Space and organization</CardTitle>
            <CardDescription>
              {pendingSpaceInvites.length > 0
                ? 'You have pending Space invitations. Accept one below, or use the workspace menu in the sidebar.'
                : 'No Space membership yet. You need an invitation to join a Space, or create an organization from onboarding.'}
            </CardDescription>
          </CardHeader>
        </Card>
        <ProfileWorkspaceInvitesClient invites={pendingSpaceInvites} />
      </div>
    );
  }

  const { spaces, activeSpace, needsSpaceChoice } = workspace;

  return (
    <div className="flex flex-col gap-6">
      <Card data-testid="profile-workspace-card">
        <CardHeader>
          <CardTitle className="text-xl">Space and organization</CardTitle>
          <CardDescription>
            Your product data is scoped to a Space. The active Space is used for
            gateway routing and apps that require a Space context.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ProfileWorkspaceInvitesClient invites={pendingSpaceInvites} />
          {needsSpaceChoice ? (
            <div
              className="bg-muted/50 border-border flex flex-col gap-2 rounded-lg border p-4"
              role="status"
            >
              <div className="font-medium">Choose a Space</div>
              <p className="text-muted-foreground text-sm">
                You belong to more than one Space. Pick one to set the active
                Space cookie.
              </p>
              <p className="text-muted-foreground text-sm">
                Use the sidebar workspace menu to choose the active Space.
              </p>
            </div>
          ) : null}

          {activeSpace ? (
            <div className="flex flex-col gap-3">
              <div>
                <div className="text-muted-foreground mb-1 text-xs font-medium uppercase">
                  Active Space
                </div>
                <div className="flex items-center gap-2">
                  <EntityAvatar
                    name={activeSpace.name}
                    avatarUrl={activeSpace.avatarUrl}
                    className="size-6"
                    fallbackClassName="text-[10px]"
                  />
                  <div
                    className="font-medium"
                    data-testid="profile-active-space-name"
                  >
                    {activeSpace.name}
                  </div>
                </div>
                <div className="text-muted-foreground text-sm">
                  Slug:{' '}
                  <span className="font-mono text-xs">{activeSpace.slug}</span>
                </div>
                {activeSpace.roles.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {activeSpace.roles.map((role) => (
                      <Badge
                        key={`active-space-${activeSpace.spaceId}-${role.key}`}
                        variant="secondary"
                        className="text-[11px]"
                      >
                        {role.label}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
              <div>
                <div className="text-muted-foreground mb-1 text-xs font-medium uppercase">
                  Organization
                </div>
                <div className="flex items-center gap-2">
                  <EntityAvatar
                    name={activeSpace.orgName}
                    avatarUrl={activeSpace.orgAvatarUrl}
                    className="size-6"
                    fallbackClassName="text-[10px]"
                  />
                  <div className="font-medium">{activeSpace.orgName}</div>
                </div>
                <div className="text-muted-foreground text-sm">
                  Slug:{' '}
                  <span className="font-mono text-xs">
                    {activeSpace.orgSlug}
                  </span>
                </div>
                {activeSpace.orgRoles.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {activeSpace.orgRoles.map((role) => (
                      <Badge
                        key={`active-org-${activeSpace.organizationId}-${role.key}`}
                        variant="secondary"
                        className="text-[11px]"
                      >
                        {role.label}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : !needsSpaceChoice ? (
            <p className="text-muted-foreground text-sm">
              No active Space could be resolved from your session cookie.
            </p>
          ) : null}

          {spaces.length > 1 ? (
            <div className="flex flex-col gap-1">
              <div className="text-muted-foreground text-xs font-medium uppercase">
                All Spaces you belong to
              </div>
              <ul className="flex flex-col gap-2">
                {spaces.map((s) => (
                  <li
                    key={s.spaceId}
                    className="border-border flex flex-col gap-0.5 rounded-md border px-3 py-2 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <EntityAvatar
                        name={s.name}
                        avatarUrl={s.avatarUrl}
                        className="size-6"
                        fallbackClassName="text-[10px]"
                      />
                      <span className="font-medium">{s.name}</span>
                    </div>
                    <span className="text-muted-foreground text-xs">
                      {s.orgName} · {s.slug}
                    </span>
                    {s.roles.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {s.roles.map((role) => (
                          <Badge
                            key={`${s.spaceId}-${role.key}`}
                            variant="secondary"
                            className="text-[11px]"
                          >
                            {role.label}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground text-sm">
                Switch the active Space from the sidebar workspace menu.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
