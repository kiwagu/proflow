import type { CollectionConfig, RequestContext } from 'payload';
import { APIError } from 'payload';

function isSpaceOrgSyncContext(context: RequestContext): boolean {
  return context.allowAuthorSpaceOrgWrite === true;
}

export const Spaces: CollectionConfig = {
  slug: 'spaces',
  admin: {
    useAsTitle: 'name',
    description:
      'Product Space (tenant). Mirrored from Postgres — not provisioned manually here.',
  },
  access: {
    create: () => false,
    delete: () => false,
    update: ({ req }) => Boolean(req.user),
    read: ({ req }) => Boolean(req.user),
  },
  hooks: {
    beforeChange: [
      ({ context }) => {
        if (isSpaceOrgSyncContext(context)) {
          return;
        }
        throw new APIError(
          'Spaces are mirrored from the Platform; they cannot be changed from this app.',
          403,
          undefined,
          true
        );
      },
    ],
    beforeDelete: [
      ({ context }) => {
        if (isSpaceOrgSyncContext(context)) {
          return;
        }
        throw new APIError(
          'Spaces are mirrored from the Platform; they cannot be deleted from this app.',
          403,
          undefined,
          true
        );
      },
    ],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: { readOnly: true },
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      required: true,
      admin: { readOnly: true },
    },
  ],
};
