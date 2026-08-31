/**
 * In-memory doubles of the persistence ports, for unit tests and for any
 * consumer that must run without a browser. Behaviour mirrors the real
 * adapters: watches fire immediately and after every mutation; soft-deleted
 * rows disappear from watches.
 */
export * from './chat.js';
export * from './document.js';
