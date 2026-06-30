'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@workspace/ui/components/button';
import { BorderedRow } from '@workspace/ui/components/platform/bordered-row';

import type { PlatformPendingSpaceInvite } from '@/lib/platform-shell.types';
import { acceptSpaceInviteAction } from '@/lib/space-invite.accept.actions';

type ProfileWorkspaceInvitesClientProps = Readonly<{
  invites: readonly PlatformPendingSpaceInvite[];
}>;

export function ProfileWorkspaceInvitesClient({
  invites,
}: ProfileWorkspaceInvitesClientProps) {
  const router = useRouter();
  const [busyToken, setBusyToken] = useState<string | null>(null);

  if (invites.length === 0) {
    return null;
  }

  return (
    <div
      className="border-border bg-muted/30 flex flex-col gap-3 rounded-lg border p-4"
      data-testid="profile-pending-invites"
    >
      <div className="font-medium">Pending invitations</div>
      <p className="text-muted-foreground text-sm">
        Accept an invite to join a Space with your current sign-in email.
      </p>
      <ul className="flex flex-col gap-2">
        {invites.map((inv) => (
          <BorderedRow
            key={inv.id}
            as="li"
            className="bg-background flex-wrap gap-2"
            actions={
              <Button
                type="button"
                size="sm"
                disabled={busyToken === inv.token}
                onClick={() => {
                  void (async () => {
                    setBusyToken(inv.token);
                    const res = await acceptSpaceInviteAction(inv.token);
                    setBusyToken(null);
                    if (!res.ok) return;
                    router.refresh();
                  })();
                }}
              >
                Accept
              </Button>
            }
          >
            <div className="flex min-w-0 flex-col gap-0.5 text-sm">
              <span className="font-medium">{inv.spaceName}</span>
              <span className="text-muted-foreground text-xs">
                {inv.spaceSlug ? `${inv.spaceSlug} · ` : null}
                Role: {inv.roleLabel}
              </span>
            </div>
          </BorderedRow>
        ))}
      </ul>
    </div>
  );
}
