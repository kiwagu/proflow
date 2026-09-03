/**
 * The action catalogue for the block-insert menu.
 *
 * The `/` trigger itself is not registered here: the node vocabulary carries
 * no in-document trigger node, so the trigger belongs to the app layer as
 * typeahead configuration over live text. This module only exports what such
 * a menu needs — the actions and their node dependencies.
 */
export * from './actions';
export * from './types';
