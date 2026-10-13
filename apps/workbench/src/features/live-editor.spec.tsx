/**
 * The registry of editor INSTANCES on screen, for surfaces that render over
 * the open editor from outside it (the outline in the aside).
 */
import type { LexicalWrapper } from '@workspace/lexical-react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import {
  createLiveEditors,
  LiveEditorsProvider,
  useLiveEditor,
} from './live-editor';

const wrapper = (name: string) => ({ name }) as unknown as LexicalWrapper;

describe('the registry of editors on screen', () => {
  it('answers with the editor mounted for a document and notifies on change', () => {
    const live = createLiveEditors();
    const listener = vi.fn();
    live.subscribe(listener);

    const release = live.register({
      documentId: 'doc-1',
      wrapper: wrapper('a'),
    });
    expect(live.get('doc-1')?.wrapper).toEqual(wrapper('a'));
    expect(listener).toHaveBeenCalledTimes(1);

    release();
    expect(live.get('doc-1')).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('lets a stale release leave a newer registration alone', () => {
    const live = createLiveEditors();
    const releaseOld = live.register({
      documentId: 'doc-1',
      wrapper: wrapper('old'),
    });
    live.register({ documentId: 'doc-1', wrapper: wrapper('new') });
    releaseOld();
    expect(live.get('doc-1')?.wrapper).toEqual(wrapper('new'));
  });

  it('re-renders a hook reader when the editor for its document mounts', () => {
    const live = createLiveEditors();
    const Provider = ({ children }: { children: ReactNode }) => (
      <LiveEditorsProvider value={live}>{children}</LiveEditorsProvider>
    );
    const { result } = renderHook(() => useLiveEditor('doc-1'), {
      wrapper: Provider,
    });
    expect(result.current).toBeNull();

    act(() => {
      live.register({ documentId: 'doc-1', wrapper: wrapper('a') });
    });
    expect(result.current?.wrapper).toEqual(wrapper('a'));
  });
});
