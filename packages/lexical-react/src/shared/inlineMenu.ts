/**
 * @file Shared code for inline menus.
 */

import type { Accessor, Setter } from '../reactive/signal';
import { createSignal } from '../reactive/signal';

export type MenuOperations = {
  openMenu: () => void;
  closeMenu: () => void;
  searchTerm: Accessor<string>;
  setSearchTerm: (searchTerm: string) => void;
  isOpen: Accessor<boolean>;
  setIsOpen: Setter<boolean>;
  /** Subscribe to open/close and search-term changes. */
  subscribe: (onChange: () => void) => () => void;
};

export function createMenuOperations(
  onOpenCallback?: () => void,
  onCloseCallback?: () => void
): MenuOperations {
  const isOpen = createSignal(false);
  const searchTerm = createSignal('');

  const menuOperations: MenuOperations = {
    openMenu: () => {
      onOpenCallback?.();
      isOpen.set(true);
    },
    closeMenu: () => {
      onCloseCallback?.();
      isOpen.set(false);
    },
    searchTerm: searchTerm.get,
    setSearchTerm: searchTerm.set,
    isOpen: isOpen.get,
    setIsOpen: isOpen.set,
    subscribe: (onChange) => {
      const unsubscribes = [
        isOpen.subscribe(onChange),
        searchTerm.subscribe(onChange),
      ];
      return () => {
        for (const unsubscribe of unsubscribes) unsubscribe();
      };
    },
  };

  return menuOperations;
}
