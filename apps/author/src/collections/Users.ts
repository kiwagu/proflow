import type { Access, CollectionConfig, RequestContext } from 'payload';
import { APIError } from 'payload';

import {
  payloadJwtStrategy,
  supabaseAuthStrategy,
} from '../auth/supabaseAuthStrategy';

function isAuthorUsersWriteContext(context: RequestContext): boolean {
  return context.allowAuthorUsersWrite === true;
}

/** Any signed-in admin user may open any user document (read-only in practice; see hooks + Save UI). */
const readForAuthenticatedAdmin: Access = ({ req }) => Boolean(req.user);

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
    description:
      'Mirror of platform identities for CMS sign-in. The directory is visible for support; user accounts are managed centrally on the Platform — not edited here.',
    components: {
      edit: {
        SaveButton: '/admin/users.centralized-save-button',
      },
    },
  },
  access: {
    create: () => false,
    delete: () => false,
    update: ({ req }) => Boolean(req.user),
    read: readForAuthenticatedAdmin,
  },
  hooks: {
    beforeChange: [
      ({ context }) => {
        if (isAuthorUsersWriteContext(context)) {
          return;
        }
        throw new APIError(
          'User accounts are managed centrally on the Platform; they cannot be changed from this app.',
          403,
          undefined,
          true
        );
      },
    ],
    beforeDelete: [
      ({ context }) => {
        if (isAuthorUsersWriteContext(context)) {
          return;
        }
        throw new APIError(
          'User accounts are managed centrally on the Platform; they cannot be deleted from this app.',
          403,
          undefined,
          true
        );
      },
    ],
  },
  auth: {
    disableLocalStrategy: {
      enableFields: true,
      optionalPassword: true,
    },
    strategies: [supabaseAuthStrategy, payloadJwtStrategy],
  },
  fields: [
    {
      name: 'supabaseSub',
      type: 'text',
      index: true,
      unique: true,
      admin: {
        description: 'Platform identity id (`sub` from the access token).',
        readOnly: true,
      },
    },
  ],
};
