import type { RequestContext } from 'payload';

/**
 * Local API context for JetStream-driven org/space mirror writes (not admin UI).
 */
export const AUTHOR_SPACE_ORG_WRITE_CONTEXT: RequestContext = {
  allowAuthorSpaceOrgWrite: true,
};
