import type { LexicalWrapper } from '@workspace/lexical-react';
import { render, cleanup, fireEvent, screen, act } from '@testing-library/react';
import { $createHeadingNode } from '@lexical/rich-text';
import { $createTextNode, $getRoot } from 'lexical';
import { afterEach, describe, expect, it } from 'vitest';
import { DocumentView } from './document-view.js';
import { Outline } from './outline-panel.js';

afterEach(() => {
  cleanup();
});

function renderOutline() {
  let wrapper: LexicalWrapper | undefined;
  const scrollContainer = document.createElement('div');
  const utils = render(
    <DocumentView
      onWrapper={(w) => {
        wrapper = w;
      }}
    >
      <Outline scrollContainer={scrollContainer} />
    </DocumentView>
  );
  if (!wrapper) throw new Error('wrapper not captured');
  return { wrapper, scrollContainer, ...utils };
}

function loadHeadings(wrapper: LexicalWrapper, texts: string[]) {
  act(() => {
    wrapper.editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        for (const text of texts) {
          const heading = $createHeadingNode('h2');
          heading.append($createTextNode(text));
          root.append(heading);
        }
      },
      { discrete: true }
    );
  });
}

describe('Outline', () => {
  it('renders nothing below the minimum heading count', () => {
    const { wrapper } = renderOutline();
    loadHeadings(wrapper, ['One', 'Two']);
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('lists every heading once the minimum is reached', () => {
    const { wrapper } = renderOutline();
    loadHeadings(wrapper, ['One', 'Two', 'Three']);

    expect(screen.getByRole('navigation')).toBeTruthy();
    for (const text of ['One', 'Two', 'Three']) {
      expect(screen.getByLabelText(text)).toBeTruthy();
    }
  });

  it('scrolls the container when a heading is clicked', () => {
    const { wrapper, scrollContainer } = renderOutline();
    loadHeadings(wrapper, ['One', 'Two', 'Three']);
    scrollContainer.scrollTo = () => {};
    const scrollToSpy = (scrollContainer.scrollTo = () => {
      scrollToSpy.called = true;
    }) as (() => void) & { called?: boolean };

    fireEvent.click(screen.getByLabelText('Two'));

    expect(scrollToSpy.called).toBe(true);
  });
});
