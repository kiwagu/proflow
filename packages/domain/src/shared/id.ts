import { createEntityIdFor, type EntityKind } from '@workspace/entity-id';

export type { EntityKind };

/** The single local user of this frontend-only app. */
export const LOCAL_USER_ID = 'local-user';

/**
 * New id for a row of `kind`.
 *
 * Ids are minted here, never by the database: a command that must show its
 * outcome before the write lands has to know the id up front, and a
 * local-first row that will one day sync cannot wait for a server sequence.
 * The id carries its kind and its creation time, so a row that turns up
 * where it should not be says what it is.
 */
export function newId(kind: EntityKind): string {
  return createEntityIdFor(kind);
}

/** Current time. Kept as a function so tests can pass explicit values instead. */
export function now(): Date {
  return new Date();
}
