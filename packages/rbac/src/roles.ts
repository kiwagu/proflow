export const RBAC_ROLE_KEYS = {
  member: 'member',
  spaceAdmin: 'space_admin',
  orgAdmin: 'org_admin',
  student: 'student',
  tutor: 'tutor',
  manager: 'manager',
} as const;

export type RbacRoleKey = (typeof RBAC_ROLE_KEYS)[keyof typeof RBAC_ROLE_KEYS];

export function isRbacRoleKey(value: string): value is RbacRoleKey {
  return Object.values(RBAC_ROLE_KEYS).includes(value as RbacRoleKey);
}
