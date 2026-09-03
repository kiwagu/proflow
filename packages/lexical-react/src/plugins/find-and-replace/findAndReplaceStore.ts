import { createStore } from '../../reactive/store';
import type { NodekeyOffset } from './findAndReplacePlugin';
import type { FloatingStyle } from './getFloatingSearchHighlightStyle';

/**
 * Find-and-replace state for the open document.
 *
 * The plugin itself is store-agnostic (it takes `getListOffset` /
 * `setListOffset` props), so this store is the binding layer's default wiring
 * for a host that has one document open at a time. A host that shows several
 * documents at once can skip it and pass its own accessors to the plugin.
 */
export interface FindAndReplaceState {
  searchIsOpen: boolean;
  isSearching: boolean;
  searchInputText: string;
  replaceInputOpen: boolean;
  replaceInputText: string;
  listOffset: NodekeyOffset[];
  styles: { style: FloatingStyle; idx: number | undefined }[];
  matches: number;
  currentMatch: number;
  currentQuery: string;
}

const initialState: FindAndReplaceState = {
  searchIsOpen: false,
  isSearching: false,
  searchInputText: '',
  replaceInputOpen: false,
  replaceInputText: '',
  listOffset: [],
  styles: [],
  matches: 0,
  currentMatch: -1,
  currentQuery: '',
};

export const [FindAndReplaceStore, setFindAndReplaceState] =
  createStore<FindAndReplaceState>(initialState);
