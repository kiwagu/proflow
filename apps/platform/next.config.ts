import type { NextConfig } from 'next';
import process from 'node:process';

import { isDevFullRequestLoggingEnabled } from '@workspace/gateway-auth/dev-mutating-request-log';
import { getAppBasePath } from '@workspace/gateway-auth/gateway-paths';

const isDev = process.env.NODE_ENV !== 'production';

const nextConfig: NextConfig = {
  basePath: getAppBasePath('/platform'),
  cacheComponents: !isDev,
  transpilePackages: ['@workspace/ui'],
  ...(isDev && {
    allowedDevOrigins: [
      'http://localhost:3000',
      'proflow.local',
      'https://proflow.local',
      'http://proflow.local',
    ],
    ...(!isDevFullRequestLoggingEnabled() && {
      logging: {
        incomingRequests: false,
      },
    }),
  }),
};

export default nextConfig;
