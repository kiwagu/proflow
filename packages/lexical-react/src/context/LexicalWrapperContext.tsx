/**
 * @file Wrap the Lexical Editor in some helpful utilities.
 */
import {
  type EditorType,
  type NodeIdMappings,
  nodeIdPlugin,
  RegisteredNodesByType,
  SupportedNodeTypes,
} from '@workspace/lexical-nodes';
import {
  createEditor,
  type EditorThemeClasses,
  type LexicalEditor,
  type NodeKey,
} from 'lexical';
import { createContext, useContext } from 'react';
import type { StoreHandle } from '../reactive/store';
import {
  createPluginManager,
  insertTextPlugin,
  nodeTransformPlugin,
  type PluginManager,
  type SelectionData,
} from '../plugins';
import { theme as baseTheme } from '../theme';

type LexicalWrapperProps = {
  type: EditorType;
  namespace: string;
  isInteractable: () => boolean;
  withIds?: boolean;
  theme?: EditorThemeClasses;
};

export type LexicalWrapperBase = {
  type: EditorType;
  plugins: PluginManager;
  editor: LexicalEditor;
  cleanup: () => void;
  isInteractable: () => boolean;
  /**
   * Live selection state, published by the selection-data plugin. It is a
   * store handle rather than a snapshot so plugins can read it imperatively
   * and components can subscribe via `useStore`.
   */
  selection?: StoreHandle<SelectionData>;
  /** When true, decorator components should skip backend fetches (e.g. preview API). */
  skipPreviewFetch?: boolean;
};

export type LexicalWrapperWithMapping = LexicalWrapperBase & {
  mapping: NodeIdMappings;
};

export type LexicalWrapper = LexicalWrapperBase | LexicalWrapperWithMapping;

export const LexicalWrapperContext = createContext<LexicalWrapper | undefined>(
  undefined
);

/** Read the wrapper provided by the nearest editor mount. */
export function useLexicalWrapper(): LexicalWrapper {
  const wrapper = useContext(LexicalWrapperContext);
  if (!wrapper) {
    throw new Error('useLexicalWrapper must be used inside an editor mount');
  }
  return wrapper;
}

/** Read the wrapper without asserting that an editor mount is present. */
export function useMaybeLexicalWrapper(): LexicalWrapper | undefined {
  return useContext(LexicalWrapperContext);
}

// Simple increasing id to differentiate multiple editors on page.
let _id = 0;

/**
 * Create a Lexical wrapper with extra utilities for adding plugins and tracking
 * cleanup functions.
 * @param type The type of editor to create. The current options are 'markdown',
 *     'plain-text', 'chat', and 'title' which are each configured to include
 *     and exclude node lists tailored to those use cases.
 * @param namespace A namespace hint for the editor - useful for debugging.
 * @param isInteractable A function that returns true if when the editor should be interactable.
 * @param withIds If true, the editor will have node ids and the wrapper will have a
 *     bi-directional durable nodeId <- -> ephemeral nodeKey mapping managed by the nodeId plugin.
 */

export function createLexicalWrapper(
  props: LexicalWrapperProps & { withIds: true }
): LexicalWrapperWithMapping;

export function createLexicalWrapper(
  props: LexicalWrapperProps & { withIds?: false | undefined }
): LexicalWrapperBase;

export function createLexicalWrapper({
  type,
  namespace,
  isInteractable,
  withIds,
  theme,
}: LexicalWrapperProps): LexicalWrapper {
  _id++;

  // The editor-type registry is the whole node set: the vocabulary uses the
  // stock code node, so there is nothing to swap in at construction.
  const nodes = RegisteredNodesByType[type];

  const editor = createEditor({
    theme: theme ?? baseTheme,
    namespace: namespace + '_' + _id,
    nodes: [...nodes],
    onError: console.error,
  });

  const plugins = createPluginManager(editor, type);

  let mapping: NodeIdMappings | undefined;

  // Default plugins here.
  plugins.use(insertTextPlugin());
  plugins.use(nodeTransformPlugin());

  if (withIds) {
    mapping = createMapping();
    plugins.use(
      nodeIdPlugin({
        nodes: SupportedNodeTypes,
        mappings: mapping,
      })
    );
  }

  const cleanup = () => {
    plugins.cleanup();
  };

  return {
    plugins,
    editor,
    cleanup,
    type,
    isInteractable,
    mapping,
  };
}

export function isWrapperWithIds(
  wrapper: LexicalWrapper | undefined
): wrapper is LexicalWrapperWithMapping {
  return Boolean(
    wrapper && 'mapping' in wrapper && wrapper['mapping'] !== undefined
  );
}

function createMapping(): NodeIdMappings {
  const idToNodeKeyMap: Map<string, NodeKey> = new Map();
  const nodeKeyToIdMap: Map<NodeKey, string> = new Map();

  const nodeIdMappings: NodeIdMappings = {
    idToNodeKeyMap,
    nodeKeyToIdMap,
  };

  return nodeIdMappings;
}
