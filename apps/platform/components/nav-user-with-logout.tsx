'use client';

import { NavUser } from '@workspace/ui/components/nav-user';
import { gatewayPlatformMountedPath } from '@workspace/gateway-auth/gateway-paths';
import { absoluteUrlForGatewayPath } from '@workspace/gateway-auth/post-auth-navigation';
import { ThemeSwitcher } from '@/components/theme-switcher';

export function NavUserWithLogout({
  user,
}: {
  user: {
    name: string;
    email: string;
    avatar: string;
  };
}) {
  const handleLogout = () => {
    window.location.assign(
      absoluteUrlForGatewayPath(
        window.location.origin,
        gatewayPlatformMountedPath('/auth/signout')
      )
    );
  };

  return (
    <div className="flex items-center gap-2">
      <ThemeSwitcher />
      <NavUser user={user} onLogout={handleLogout} />
    </div>
  );
}
