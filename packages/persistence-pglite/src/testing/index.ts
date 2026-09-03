/**
 * In-memory doubles of the persistence ports, for unit tests and for any
 * consumer that must run without a browser. Behaviour mirrors the real
 * adapters: watches fire immediately and after every mutation; soft-deleted
 * rows disappear from watches.
 *
 * Also exports a REAL migrated PGlite, for the suites whose subject is what
 * the store actually does (recursive walks, upserts on natural keys, live
 * queries firing after a write) rather than which calls a component makes.
 */
export * from './chat.js';
export * from './document.js';
export {
  openTestDb as openTestDatabase,
  OTHER_USER as TEST_OTHER_USER,
  TEST_USER as TEST_USER_ID,
  testId,
} from '../graph/graph.test-db.js';
