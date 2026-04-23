import { revalidatePath } from 'next/cache';

import { gatewayPlatformMountedPath } from '@workspace/gateway-auth/gateway-paths';

/**
 * Next.js cache tags follow the mounted gateway path, not the internal app path.
 */
export function revalidatePlatformPath(internalPath: string): void {
  revalidatePath(gatewayPlatformMountedPath(internalPath));
}
