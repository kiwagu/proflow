import { getAppBasePath } from '@workspace/gateway-auth/gateway-paths';

/** Must match `basePath` in `next.config.ts` (used for client-side API URLs). */
export const AUTHOR_BASE_PATH = getAppBasePath('/author');
