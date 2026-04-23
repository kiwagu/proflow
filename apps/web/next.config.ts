import type { NextConfig } from 'next';
import process from 'node:process';

import { isDevFullRequestLoggingEnabled } from '@workspace/gateway-auth/dev-mutating-request-log';

import { devRewriteRules } from './lib/gateway-config';

const isDev = process.env.NODE_ENV !== 'production';
const devCorsOrigin =
  process.env.GATEWAY_ENTRY_ORIGIN ?? 'http://localhost:3000';

const nextConfig: NextConfig = {
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
  async rewrites() {
    if (!isDev) {
      return [];
    }
    return devRewriteRules();
  },
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

export default nextConfig;
