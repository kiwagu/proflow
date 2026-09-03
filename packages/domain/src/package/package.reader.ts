import type { Unsubscribe } from '../shared/subscription.js';

/**
 * Port: the reactive read side of what has been unpacked.
 *
 * An archive and the package it becomes are two states of the same file,
 * and which one it is in decides what opening it will do — unpack first,
 * or run straight away. The explorer says so before the click, so the
 * whole set is delivered: it is one row per unpacked archive, and a list
 * that small is cheaper to hold than a question asked per row.
 */
export interface IPackageReader {
  /** Hashes of every unpacked archive, now and on every change. */
  watchUnpacked(cb: (hashes: string[]) => void): Unsubscribe;
}
