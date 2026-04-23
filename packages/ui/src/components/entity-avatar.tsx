'use client';

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@workspace/ui/components/avatar';
import { cn } from '@workspace/ui/lib/utils';

type EntityAvatarProps = {
  name: string;
  avatarUrl?: string | null;
  className?: string;
  fallbackClassName?: string;
};

function resolveInitials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean).slice(0, 2);

  if (parts.length === 0) {
    return '??';
  }

  return parts
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2);
}

export function EntityAvatar({
  name,
  avatarUrl,
  className,
  fallbackClassName,
}: EntityAvatarProps) {
  return (
    <Avatar className={cn('size-8 rounded-full', className)}>
      <AvatarImage src={avatarUrl || undefined} alt={name} />
      <AvatarFallback
        className={cn('text-xs font-semibold uppercase', fallbackClassName)}
      >
        {resolveInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
