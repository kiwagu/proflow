import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { buildConfig } from 'payload';
import { mongooseAdapter } from '@payloadcms/db-mongodb';
import { lexicalEditor } from '@payloadcms/richtext-lexical';
import { en } from '@payloadcms/translations/languages/en';
import { es } from '@payloadcms/translations/languages/es';
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant';
import { s3Storage } from '@payloadcms/storage-s3';

import { customIdPlugin } from '@workspace/payload-plugins';

import { Organizations } from './collections/Organizations';
import { Spaces } from './collections/Spaces';
import { Users } from './collections/Users';
import { Media } from './collections/Media';
import { customTranslations } from './i18n/custom-translations';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const s3Endpoint =
  process.env.S3_ENDPOINT?.trim() ||
  (supabaseUrl ? `${supabaseUrl}/storage/v1/s3` : '');
const s3AccessKeyId =
  process.env.S3_ACCESS_KEY_ID?.trim() ||
  process.env.S3_PROTOCOL_ACCESS_KEY_ID?.trim() ||
  '';
const s3SecretAccessKey =
  process.env.S3_SECRET_ACCESS_KEY?.trim() ||
  process.env.S3_PROTOCOL_ACCESS_KEY_SECRET?.trim() ||
  '';

if (!s3Endpoint) {
  throw new Error(
    'Author media S3 endpoint is not configured. Set S3_ENDPOINT or NEXT_PUBLIC_SUPABASE_URL.'
  );
}

if (!s3AccessKeyId || !s3SecretAccessKey) {
  throw new Error(
    'Author media S3 credentials are not configured. Set S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY or S3_PROTOCOL_ACCESS_KEY_ID/S3_PROTOCOL_ACCESS_KEY_SECRET.'
  );
}

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    components: {
      providers: ['/admin/active-space.sync-provider.client'],
      logout: {
        Button: '/admin/logout-button',
      },
    },
  },
  collections: [Organizations, Spaces, Users, Media],
  editor: lexicalEditor(),
  i18n: {
    supportedLanguages: {
      en,
      es,
    },
    translations: customTranslations,
  },
  upload: {
    limits: {
      fileSize: 5_000_000,
    },
  },
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: mongooseAdapter({
    url: process.env.MONGO_URL || '',
  }),
  sharp,
  plugins: [
    multiTenantPlugin({
      tenantsSlug: 'spaces',
      collections: {
        media: {},
      },
      userHasAccessToAllTenants: (user) =>
        Boolean(
          (user as { hasAuthorAllTenantsCapability?: boolean })
            .hasAuthorAllTenantsCapability
        ),
    }),
    customIdPlugin(
      { organizations: 'org', spaces: 'spc' },
      { field: 'id', mode: 'validate' }
    ),
    s3Storage({
      collections: {
        media: true,
      },
      bucket: 'media',
      config: {
        endpoint: s3Endpoint,
        credentials: {
          accessKeyId: s3AccessKeyId,
          secretAccessKey: s3SecretAccessKey,
        },
        region: process.env.S3_REGION || 'us-east-1',
        forcePathStyle: true,
      },
    }),
  ],
});
