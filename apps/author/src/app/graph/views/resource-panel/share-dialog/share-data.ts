import type {
  GrantableMembersPage,
  ResourceFloor,
  ScopeChoice,
  UserGrant,
} from '@/app/graph/graph-data.types';

/**
 * ShareData — the full Share payload returned by `/author/graph/visibility`: the
 * broadcast floor, the cohort choices, the per-user grants, and ONE keyset page of
 * grantable members (ADR-0021 Part A). The floor/cohort/grant slices are reloaded
 * wholesale after a mutation; only `members` is cursor-paged by the people-picker.
 */
export type ShareData = {
  floor: ResourceFloor | null;
  choices: ScopeChoice[];
  grants: UserGrant[];
  // The route's `members` is ONE keyset page (ADR-0021 Part A): { items, nextCursor,
  // total }. The reusable `AsyncSearchPicker` (Wave 1b) consumes the full page —
  // cursor-paged, with a "+N more" count + "Show more". The floor/cohort load reads
  // `members` for nothing now (the picker fetches its own pages); it rides along.
  members: GrantableMembersPage;
};

/** Page size for the people-picker (ADR-0021 §A3 — a small fixed page of 5 that
 * invites narrowing by typing; the server hard-caps at 50). */
export const MEMBERS_PAGE_SIZE = 5;

export const EMPTY_PAGE: GrantableMembersPage = {
  items: [],
  nextCursor: null,
  total: 0,
};

export const EMPTY_DATA: ShareData = {
  floor: null,
  choices: [],
  grants: [],
  members: EMPTY_PAGE,
};
