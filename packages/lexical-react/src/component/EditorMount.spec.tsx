import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { LexicalWrapper } from '../context/LexicalWrapperContext';
import { EditorMount } from './EditorMount';

afterEach(() => {
  cleanup();
});

describe('EditorMount', () => {
  it('mounts a contenteditable and attaches the editor to it', () => {
    let wrapper: LexicalWrapper | undefined;

    const { container } = render(
      <EditorMount
        type="markdown"
        namespace="mount-smoke"
        onWrapper={(w) => {
          wrapper = w;
        }}
      />
    );

    const editable = container.querySelector('[data-lexical-editor]');
    expect(editable).not.toBeNull();
    expect(wrapper).toBeDefined();
    expect(wrapper?.editor.getRootElement()).toBe(editable);
  });

  it('detaches the editor root when unmounted', () => {
    let wrapper: LexicalWrapper | undefined;

    const { unmount } = render(
      <EditorMount
        type="markdown"
        namespace="mount-smoke-unmount"
        onWrapper={(w) => {
          wrapper = w;
        }}
      />
    );

    expect(wrapper?.editor.getRootElement()).not.toBeNull();

    unmount();

    expect(wrapper?.editor.getRootElement()).toBeNull();
  });

  it('exposes a plugin manager and a live interactable flag', () => {
    let wrapper: LexicalWrapper | undefined;
    let interactable = false;

    render(
      <EditorMount
        type="markdown"
        namespace="mount-smoke-plugins"
        isInteractable={() => interactable}
        onWrapper={(w) => {
          wrapper = w;
        }}
      />
    );

    expect(wrapper?.plugins).toBeDefined();
    expect(wrapper?.isInteractable()).toBe(false);

    interactable = true;

    // Read live rather than captured at mount, as the origin does.
    expect(wrapper?.isInteractable()).toBe(true);
  });
});
