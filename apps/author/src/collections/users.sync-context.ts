import type { RequestContext } from 'payload';

/**
 * Pass as Local API `context` so `users` hooks allow writes from centralized
 * identity sync, the login bridge, and test seeds. Admin / REST requests omit
 * this flag and are blocked.
 */
export const AUTHOR_USERS_WRITE_CONTEXT: RequestContext = {
  allowAuthorUsersWrite: true,
};
