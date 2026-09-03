/**
 * @file The surrounding block a piece of editor UI is rendered inside.
 *
 * The origin tree hosts many block kinds (documents, chats, calendars, PDFs)
 * behind a registry and a router; the editor reads only a small part of that
 * surface, and that part is what is kept here. Two facts matter to the editor:
 * whether it is inside a block at all (floating menus anchor differently when
 * it is not) and whether that block is nested inside another one (a code
 * accessory hides its own controls when it is).
 */
import { createContext, useContext } from 'react';

export const BlockRegistry = ['md', 'chat'] as const;
export type BlockName = (typeof BlockRegistry)[number];

/** Pseudo-types that share a block implementation but differ in presentation. */
export const BlockAliasRegistry = ['task', 'snippet', 'skill'] as const;
export type BlockAlias = (typeof BlockAliasRegistry)[number];

export interface BlockContextValue {
  id: string;
  name: BlockName;
  alias?: BlockAlias;
  /** Set when this block is embedded inside another one. */
  nested?: unknown;
}

export const BlockContext = createContext<BlockContextValue | undefined>(
  undefined
);

export const useMaybeBlockId = (): string | undefined =>
  useContext(BlockContext)?.id;

export const useBlockId = (): string => {
  const context = useContext(BlockContext);
  if (!context) {
    throw new Error('hook must be used within a Block component');
  }
  return context.id;
};

export const useMaybeBlockName = (): BlockName | undefined =>
  useContext(BlockContext)?.name;

export const useIsNestedBlock = (): boolean => {
  const context = useContext(BlockContext);
  if (!context) throw new Error('hook must be used within a Block component');
  return context.nested !== undefined;
};

export function useIsInBlock(): boolean {
  return useContext(BlockContext) != null;
}
