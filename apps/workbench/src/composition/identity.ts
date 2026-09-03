/**
 * The identity graph rows are written under before a session exists.
 *
 * The graph tables carry the server's column shapes — `created_by` is a
 * uuid, `space_id` an entity id — so even a signed-out workbench needs
 * well-formed values to write locally. These are placeholders for the
 * seedless local run; the Supabase session slice replaces them with the
 * signed-in user and the checked-out space, and the local database name
 * follows the user identity from then on.
 */
export const LOCAL_IDENTITY = {
  userId: '00000000-0000-4000-8000-000000000000',
  spaceId: 'spc_0000000000000000.0000000000',
} as const;
