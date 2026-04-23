/**
 * HttpOnly cookie for the user's validated active Space (Postgres `spaces.id`).
 * Shared across gateway shells (`/platform`, `/author`) and set only by server
 * after membership check.
 */
export const ACTIVE_SPACE_COOKIE = 'pf_active_space_id';

/** Cookie path shared by Platform and Author. */
export const ACTIVE_SPACE_COOKIE_PATH = '/';
/** Default TTL for the canonical active Space cookie (180 days). */
export const ACTIVE_SPACE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

/**
 * Optional one-time query param to resolve Space by slug (then redirect strip param).
 */
export const ACTIVE_SPACE_QUERY_SLUG = 'space';
