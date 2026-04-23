export type PlatformPendingSpaceInvite = Readonly<{
  id: string;
  spaceId: string;
  token: string;
  roleKey: string;
  roleLabel: string;
  expiresAt: string;
  spaceName: string;
  spaceSlug: string;
}>;
