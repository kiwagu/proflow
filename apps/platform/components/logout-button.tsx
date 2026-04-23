'use client';

import { gatewayPlatformMountedPath } from '@workspace/gateway-auth/gateway-paths';
import { absoluteUrlForGatewayPath } from '@workspace/gateway-auth/post-auth-navigation';
import { Button } from '@workspace/ui/components/button';

export function LogoutButton({ className }: { className?: string }) {
  const handleLogout = () => {
    window.location.assign(
      absoluteUrlForGatewayPath(
        window.location.origin,
        gatewayPlatformMountedPath('/auth/signout')
      )
    );
  };

  return (
    <Button
      onClick={handleLogout}
      type="button"
      className={className}
      data-testid="auth-logout-button"
    >
      Logout
    </Button>
  );
}
