import { ACTIVE_SPACE_COOKIE } from '@workspace/gateway-auth/active-space.constants';
import { APIError, type CollectionConfig, type PayloadRequest } from 'payload';

import {
  AUTHOR_MEDIA_MIME_TYPES,
  isArchiveMimeType,
  resolveAuthorMediaDeliveryMode,
  resolveAuthorMediaKind,
} from './media.contract';

function resolveTenantId(value: unknown): string | null {
  if (typeof value === 'string') {
    const tenantId = value.trim();
    return tenantId.length > 0 ? tenantId : null;
  }

  if (
    value &&
    typeof value === 'object' &&
    'id' in value &&
    typeof (value as { id?: unknown }).id === 'string'
  ) {
    const tenantId = (value as { id: string }).id.trim();
    return tenantId.length > 0 ? tenantId : null;
  }

  return null;
}

const PAYLOAD_TENANT_COOKIE = 'payload-tenant';

function readCookieValue(
  req: PayloadRequest,
  cookieName: string
): string | null {
  const cookieHeader = req.headers.get('cookie');
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(';')) {
    const [name, ...valueParts] = part.trim().split('=');
    if (name !== cookieName) {
      continue;
    }

    const value = valueParts.join('=').trim();
    return value.length > 0 ? decodeURIComponent(value) : null;
  }

  return null;
}

export function buildAuthorMediaPrefix(tenantId: string): string {
  return `spaces/${tenantId}/author`;
}

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: () => true,
  },
  hooks: {
    beforeChange: [
      ({ data, originalDoc, req }) => {
        const tenantFromCookies =
          readCookieValue(req, PAYLOAD_TENANT_COOKIE) ??
          readCookieValue(req, ACTIVE_SPACE_COOKIE);
        const tenantId =
          resolveTenantId(data?.tenant) ??
          resolveTenantId(originalDoc?.tenant) ??
          resolveTenantId(tenantFromCookies);
        const mimeTypeValue =
          typeof data?.mimeType === 'string'
            ? data.mimeType
            : typeof originalDoc?.mimeType === 'string'
              ? originalDoc.mimeType
              : null;

        if (!tenantId) {
          throw new APIError(
            'Author media uploads require an active space tenant.',
            400,
            undefined,
            true
          );
        }

        const mediaKind = mimeTypeValue
          ? resolveAuthorMediaKind(mimeTypeValue)
          : null;

        if (mimeTypeValue && isArchiveMimeType(mimeTypeValue)) {
          throw new APIError(
            'Archive uploads are not enabled yet. Upload extracted files instead.',
            400,
            undefined,
            true
          );
        }

        if (mimeTypeValue && !mediaKind) {
          throw new APIError(
            'Author media supports image, text, audio, and video uploads only.',
            400,
            undefined,
            true
          );
        }

        return {
          ...(data ?? {}),
          tenant: tenantId,
          deliveryMode: mediaKind
            ? resolveAuthorMediaDeliveryMode(mediaKind)
            : data?.deliveryMode,
          mediaKind: mediaKind ?? data?.mediaKind,
          prefix: buildAuthorMediaPrefix(tenantId),
        };
      },
    ],
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
    },
    {
      name: 'mediaKind',
      type: 'select',
      admin: {
        readOnly: true,
        description:
          'Derived from the uploaded MIME type for section 8 media baseline.',
      },
      options: [
        { label: 'Image', value: 'image' },
        { label: 'Text', value: 'text' },
        { label: 'Audio', value: 'audio' },
        { label: 'Video', value: 'video' },
      ],
    },
    {
      name: 'deliveryMode',
      type: 'select',
      admin: {
        readOnly: true,
        description:
          'Derived delivery expectation: inline for text/image, stream for audio/video.',
      },
      options: [
        { label: 'Inline', value: 'inline' },
        { label: 'Stream', value: 'stream' },
      ],
    },
  ],
  upload: {
    mimeTypes: [...AUTHOR_MEDIA_MIME_TYPES],
    imageSizes: [
      {
        name: 'thumbnail',
        width: 320,
        height: 320,
        position: 'centre',
      },
      {
        name: 'card',
        width: 960,
        height: undefined,
        position: 'centre',
      },
    ],
    adminThumbnail: 'thumbnail',
    focalPoint: true,
    crop: true,
  },
};
