/**
 * @file The code box's language picker.
 *
 * The picker is the only way a language reaches a code node from the UI, so
 * what it offers decides which features are reachable at all — the SVG preview
 * toggle appears for `svg` and nowhere else. These specs assert the offer, not
 * the list literal, so building the list from the highlighter's registry stays
 * free while the languages the product ships never silently disappear.
 */
import { $createCodeNode, $isCodeNode } from '@lexical/code';
import { $getNodeByKey, $getRoot, type LexicalEditor } from 'lexical';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLexicalWrapper } from '../../context/LexicalWrapperContext';
import { BlockContext } from '../../support/block';
import { CodeBoxAccessory, StaticCodeBoxAccessory } from './CodeBoxAccessory';

let wrapper: ReturnType<typeof createLexicalWrapper>;
let editor: LexicalEditor;
let nodeKey: string;
let floatRef: HTMLElement;

beforeEach(() => {
  wrapper = createLexicalWrapper({
    type: 'markdown',
    namespace: 'code-box-spec',
    isInteractable: () => true,
  });
  editor = wrapper.editor;
  editor.setEditable(true);
  floatRef = document.createElement('div');
  document.body.append(floatRef);
  editor.update(
    () => {
      const code = $createCodeNode('plain');
      $getRoot().clear().append(code);
      nodeKey = code.getKey();
    },
    { discrete: true }
  );
});

afterEach(() => {
  floatRef.remove();
  wrapper.cleanup();
});

async function openPicker() {
  render(
    <BlockContext.Provider value={{ id: 'block', name: 'md' }}>
      <CodeBoxAccessory floatRef={floatRef} editor={editor} nodeKey={nodeKey} />
    </BlockContext.Provider>
  );
  // The accessory is positioned over the code box and starts hidden until it
  // is glued to it, so the queries have to include hidden nodes.
  const trigger = await screen.findByRole('button', {
    name: /plain text/i,
    hidden: true,
  });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
  const menu = await screen.findByRole('menu', { hidden: true });
  return within(menu).getAllByRole('menuitem', { hidden: true });
}

function labelsOf(items: HTMLElement[]): string[] {
  return items.map((item) => item.textContent?.trim() ?? '');
}

describe('code box language picker', () => {
  it('offers the shipped languages and reaches the SVG preview through the picker', async () => {
    const items = await openPicker();
    const offered = labelsOf(items);

    for (const label of [
      'Plain Text',
      'JavaScript',
      'TypeScript',
      'JSON',
      'Bash',
      'SVG',
    ]) {
      expect(offered).toContain(label);
    }

    const svg = items.find((item) => item.textContent?.trim() === 'SVG');
    expect(svg).toBeDefined();
    // Radix commits a menu selection from the keyboard as well as the pointer;
    // the keyboard path is the one jsdom models faithfully.
    (svg as HTMLElement).focus();
    fireEvent.keyDown(svg as HTMLElement, { key: 'Enter', code: 'Enter' });
    // The picker's write is a normal editor update; force it to land.
    editor.update(() => {}, { discrete: true });

    expect(
      editor.getEditorState().read(() => {
        const node = $getNodeByKey(nodeKey);
        return $isCodeNode(node) ? node.getLanguage() : null;
      })
    ).toBe('svg');
  });

  it('shows the preview toggle for the language the picker sets', () => {
    // The toggle is gated on the canonical language alone, so the accessory
    // rendered for that language is what makes the SVG preview reachable at
    // all — it is dead code if the picker cannot produce this language.
    render(<StaticCodeBoxAccessory language="svg" code="<svg />" />);

    expect(screen.getByRole('checkbox', { hidden: true })).toBeDefined();
  });
});
