export const RBAC_PERMISSION_KEYS = {
  spaceInvitesManage: 'space.invites.manage',
  spaceMembersRead: 'space.members.read',
  spaceMembersWrite: 'space.members.write',
  spaceContentAccess: 'space.content.access',
  spaceContentCreate: 'space.content.create',
  spaceContentDelete: 'space.content.delete',
  spaceContentPublish: 'space.content.publish',
  spaceContentRead: 'space.content.read',
  spaceContentUpdate: 'space.content.update',
  spaceKnowledgeRead: 'space.knowledge.read',
  spaceKnowledgeCreate: 'space.knowledge.create',
  spaceKnowledgeUpdate: 'space.knowledge.update',
  spaceKnowledgeDelete: 'space.knowledge.delete',
  spaceKnowledgeProgress: 'space.knowledge.progress',
  spaceKnowledgeTransition: 'space.knowledge.transition',
  spaceKnowledgeApprove: 'space.knowledge.approve',
  spaceUsersCreate: 'space.users.create',
  spaceUsersRead: 'space.users.read',
  spaceUsersUpdate: 'space.users.update',
  spaceUsersDelete: 'space.users.delete',
  orgSpacesCreate: 'org.spaces.create',
  orgSpacesDelete: 'org.spaces.delete',
  orgMembersRead: 'org.members.read',
  orgMembersWrite: 'org.members.write',
} as const;

export type RbacPermissionKey =
  (typeof RBAC_PERMISSION_KEYS)[keyof typeof RBAC_PERMISSION_KEYS];

export function isRbacPermissionKey(value: string): value is RbacPermissionKey {
  return Object.values(RBAC_PERMISSION_KEYS).includes(
    value as RbacPermissionKey
  );
}
