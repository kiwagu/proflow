import * as React from 'react';

import { Badge } from '@workspace/ui/components/badge';
import { cn } from '@workspace/ui/lib/utils';

export type RoleBadgeItem = { key: string; label: string };

/**
 * RoleBadgeList — a flex-wrap row of role/permission chips. Generic and i18n-free: the
 * caller passes pre-resolved `{ key, label }` items (labels already localized) and a
 * `keyPrefix` for stable React keys. When `roles` is empty it renders `emptyFallback`
 * (or nothing). `className` styles the wrapper (e.g. a leading margin); `badgeClassName`
 * styles each chip.
 */
function RoleBadgeList({
  roles,
  keyPrefix,
  variant = 'secondary',
  emptyFallback = null,
  className,
  badgeClassName,
}: {
  roles: readonly RoleBadgeItem[];
  keyPrefix: string;
  variant?: 'secondary' | 'outline';
  emptyFallback?: React.ReactNode;
  className?: string;
  badgeClassName?: string;
}) {
  if (roles.length === 0) {
    return <>{emptyFallback}</>;
  }
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {roles.map((role) => (
        <Badge
          key={`${keyPrefix}-${role.key}`}
          variant={variant}
          className={badgeClassName}
        >
          {role.label}
        </Badge>
      ))}
    </div>
  );
}

export { RoleBadgeList };
