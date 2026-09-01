import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import { registerList } from '@lexical/list';
import { CODE } from '@lexical/markdown';
import { registerPlainText } from '@lexical/plain-text';
import { registerRichText } from '@lexical/rich-text';
import { ALL_TRANSFORMERS, type EditorType } from '@workspace/lexical-nodes';
import { HR } from '@workspace/lexical-nodes/transformers/transformers';
import type { EditorState, LexicalEditor, UpdateListener } from 'lexical';
import type { Setter } from '../reactive/signal';
import { bindStateAs } from '../utils';
import { checklistPlugin } from './checklist/';
import { customDeletePlugin } from './custom-delete';
import { markdownShortcutsPlugin } from './markdown-shortcuts';
import { normalizeTripleClickPlugin } from './normalize-triple-click';

export type PluginFunction = (editor: LexicalEditor) => () => void;

/**
 * Create a binding between a LexicalEditor and the ability to register plugins
 * without having to manually track clean up functions.
 */
export function createPluginManager(editor: LexicalEditor, _type: EditorType) {
  const cleanupFunctions: Array<() => void> = [];
  // Keyed teardown for plugins that come and go over the editor's lifetime
  // (see `swap`), kept apart from the permanent registrations above.
  const slotCleanups = new Map<string, () => void>();

  const pluginManager = {
    history(timeGap = 400) {
      cleanupFunctions.push(
        registerHistory(editor, createEmptyHistoryState(), timeGap)
      );

      return pluginManager;
    },

    state<T extends EditorState | string>(
      setter: Setter<T>,
      mode?: 'json' | 'plain' | 'markdown' | 'markdown-internal'
    ) {
      cleanupFunctions.push(bindStateAs(editor, setter, mode));
      return pluginManager;
    },

    list() {
      cleanupFunctions.push(registerList(editor));
      cleanupFunctions.push(checklistPlugin()(editor));
      return pluginManager;
    },

    plainText() {
      cleanupFunctions.push(registerPlainText(editor));
      return pluginManager;
    },

    markdownShortcuts() {
      cleanupFunctions.push(
        markdownShortcutsPlugin({
          transformers: ALL_TRANSFORMERS,
          triggerOnEnterTransformers: [HR, CODE],
        })(editor)
      );
      return pluginManager;
    },

    richText() {
      cleanupFunctions.push(registerRichText(editor));
      // `registerRichText` (classic API) does not wire up triple-click
      // selection normalization the way the newer RichTextExtension does, so
      // register it explicitly here.
      cleanupFunctions.push(normalizeTripleClickPlugin()(editor));
      return pluginManager;
    },

    delete() {
      cleanupFunctions.push(customDeletePlugin()(editor));
      return pluginManager;
    },

    use(pluginFn: PluginFunction) {
      const cleanup = pluginFn(editor);
      cleanupFunctions.push(cleanup);
      return pluginManager;
    },

    /**
     * A plugin slot whose occupant can change over the editor's lifetime —
     * e.g. the table picker, registered only while the document is editable.
     *
     * The origin tracked the condition through its reactive system and
     * re-registered on change. React owns that condition in the component, so
     * the slot is imperative: the caller re-invokes this from an effect with
     * the plugin it wants registered now (or `undefined` for none), and the
     * previous occupant of that slot is torn down first. Slots are keyed so
     * two independent conditions cannot evict each other.
     *
     * @param slot Identifier for this slot; reusing it replaces its occupant.
     * @param pluginFn The plugin to register now, or `undefined` for none.
     */
    swap(slot: string, pluginFn: PluginFunction | undefined) {
      slotCleanups.get(slot)?.();
      slotCleanups.delete(slot);
      if (pluginFn) {
        slotCleanups.set(slot, pluginFn(editor));
      }
      return pluginManager;
    },

    cleanup() {
      for (const cleanup of slotCleanups.values()) cleanup();
      slotCleanups.clear();
      cleanupFunctions.forEach((cleanup) => {
        cleanup();
      });
      cleanupFunctions.length = 0;
    },

    onUpdate(callback: UpdateListener) {
      cleanupFunctions.push(editor.registerUpdateListener(callback));
    },
  };
  return pluginManager;
}

export type PluginManager = ReturnType<typeof createPluginManager>;
