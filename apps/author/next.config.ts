import { withPayload } from '@payloadcms/next/withPayload';

import { isDevFullRequestLoggingEnabled } from '@workspace/gateway-auth/dev-mutating-request-log';
import { getAppBasePath } from '@workspace/gateway-auth/gateway-paths';

const isDev = process.env.NODE_ENV !== 'production';
const devCorsOrigin =
  process.env.NEXT_PUBLIC_GATEWAY_ORIGIN ?? 'http://localhost:3000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: getAppBasePath('/author'),
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
  async headers() {
    if (!isDev) {
      return [];
    }

    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: devCorsOrigin,
          },
          {
            key: 'Access-Control-Allow-Credentials',
            value: 'true',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value:
              'Content-Type, Authorization, X-Requested-With, X-CSRF-Token, Accept',
          },
        ],
      },
    ];
  },
};

export default withPayload(nextConfig, { devBundleServerPackages: false });
