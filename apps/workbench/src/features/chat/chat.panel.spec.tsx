/**
 * The chat panel, over a session it does not own.
 *
 * Four behaviours are asserted here because each of them is where a chat
 * surface usually breaks: an unknown part kind must not take the panel down,
 * the live turn must render from `streaming` rather than the transcript, the
 * composer must tell Enter from Shift+Enter, and the view must not yank a
 * reader back to the bottom while a reply is still arriving.
 */
import type { AssistantPart } from '@workspace/workbench-agent';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatPanel } from './chat.panel';
import { stubSession } from './chat.testing';

const THINKING: AssistantPart = {
  type: 'thinking',
  thinking: 'Weighing the request',
};
const TEXT: AssistantPart = { type: 'text', text: 'The answer is 42.' };

function composer(): HTMLTextAreaElement {
  return screen.getByTestId('chat-input') as HTMLTextAreaElement;
}

/** The transcript's scroll container, with a geometry jsdom does not compute. */
function measuredViewport(geometry: {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}): HTMLElement {
  const viewport = screen.getByTestId('chat-transcript');
  let scrollTop = geometry.scrollTop;
  Object.defineProperty(viewport, 'scrollHeight', {
    configurable: true,
    get: () => geometry.scrollHeight,
  });
  Object.defineProperty(viewport, 'clientHeight', {
    configurable: true,
    get: () => geometry.clientHeight,
  });
  Object.defineProperty(viewport, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (next: number) => {
      scrollTop = next;
    },
  });
  return viewport;
}

describe('the chat panel', () => {
  it('renders the live turn from the stream, with reasoning collapsed', () => {
    render(
      <ChatPanel
        session={stubSession({
          generating: true,
          streaming: { messageId: 'msg-1', parts: [THINKING, TEXT] },
        })}
      />
    );

    // The reply itself is the point of the surface; the model's reasoning is
    // offered, not imposed, so it stays behind its own disclosure.
    expect(screen.getByText('The answer is 42.')).toBeDefined();
    expect(screen.getByText('Thinking…')).toBeDefined();
    expect(screen.queryByText('Weighing the request')).toBeNull();
  });

  it('survives a part kind it does not render', () => {
    // The model decides what it sends, and the part vocabulary grows. A
    // surface that throws on a kind it has not learned yet is a surface
    // that goes down the first time the domain adds one.
    const unknown = {
      type: 'citation',
      source: 'a.md',
    } as unknown as AssistantPart;
    render(
      <ChatPanel
        session={stubSession({
          messages: [
            {
              id: 'msg-1',
              role: 'assistant',
              text: '',
              parts: [unknown, TEXT],
              status: 'complete',
            },
          ],
        })}
      />
    );

    expect(screen.getByText('The answer is 42.')).toBeDefined();
  });

  it('sends on Enter and breaks the line on Shift+Enter', () => {
    const send = vi.fn(() => Promise.resolve());
    render(<ChatPanel session={stubSession({ send })} />);

    fireEvent.change(composer(), { target: { value: 'hello' } });
    fireEvent.keyDown(composer(), { key: 'Enter', shiftKey: true });
    expect(send).not.toHaveBeenCalled();

    fireEvent.keyDown(composer(), { key: 'Enter' });
    expect(send).toHaveBeenCalledWith('hello');
  });

  it('ignores Enter while a reply is still generating', () => {
    // Stop replaces Send during a turn, but the composer keeps the focus and
    // Enter keeps firing. Without the guard a reader who types ahead starts
    // a second turn on top of the one in flight.
    const send = vi.fn(() => Promise.resolve());
    render(<ChatPanel session={stubSession({ send, generating: true })} />);

    fireEvent.change(composer(), { target: { value: 'and another thing' } });
    fireEvent.keyDown(composer(), { key: 'Enter' });
    expect(send).not.toHaveBeenCalled();
  });

  it('follows the reply again once the reader sends', () => {
    // Scrolling up stops the view following. Sending is the reader saying
    // they are done reading back — the answer to their new question is what
    // they are waiting for, so the view must return to the bottom.
    const { rerender } = render(
      <ChatPanel
        session={stubSession({
          messages: [
            {
              id: 'msg-1',
              role: 'assistant',
              text: '',
              parts: [TEXT],
              status: 'complete',
            },
          ],
        })}
      />
    );
    const viewport = measuredViewport({
      scrollHeight: 1000,
      clientHeight: 100,
      scrollTop: 0,
    });
    fireEvent.scroll(viewport);

    fireEvent.change(composer(), { target: { value: 'what about this' } });
    fireEvent.keyDown(composer(), { key: 'Enter' });

    rerender(
      <ChatPanel
        session={stubSession({
          generating: true,
          messages: [
            {
              id: 'msg-1',
              role: 'assistant',
              text: '',
              parts: [TEXT],
              status: 'complete',
            },
          ],
          streaming: { messageId: 'msg-2', parts: [TEXT] },
        })}
      />
    );
    expect(viewport.scrollTop).toBe(1000);
  });

  it('shows Stop while generating and Send once it settles', () => {
    const { rerender } = render(
      <ChatPanel session={stubSession({ generating: true })} />
    );
    expect(screen.getByTestId('chat-stop')).toBeDefined();
    expect(screen.queryByTestId('chat-send')).toBeNull();

    rerender(<ChatPanel session={stubSession()} />);
    expect(screen.getByTestId('chat-send')).toBeDefined();
    expect(screen.queryByTestId('chat-stop')).toBeNull();
  });

  it('reports a failure above the composer rather than in a dialog', () => {
    render(<ChatPanel session={stubSession({ error: 'the model refused' })} />);
    expect(screen.getByTestId('chat-error').textContent).toContain(
      'the model refused'
    );
  });

  it('leaves the scroll alone when the reader has scrolled up', () => {
    const session = stubSession({
      generating: true,
      streaming: { messageId: 'msg-1', parts: [TEXT] },
    });
    const { rerender } = render(<ChatPanel session={session} />);
    const viewport = measuredViewport({
      scrollHeight: 1000,
      clientHeight: 100,
      scrollTop: 0,
    });
    fireEvent.scroll(viewport);

    // A part arriving while the user is reading earlier output must not drag
    // the view back down — that is the defect that makes a streaming
    // transcript unreadable.
    rerender(
      <ChatPanel
        session={stubSession({
          generating: true,
          streaming: {
            messageId: 'msg-1',
            parts: [TEXT, { type: 'text', text: ' And then some.' }],
          },
        })}
      />
    );
    expect(viewport.scrollTop).toBe(0);
  });

  it('follows the reply when the reader is already at the bottom', () => {
    const { rerender } = render(
      <ChatPanel
        session={stubSession({
          generating: true,
          streaming: { messageId: 'msg-1', parts: [TEXT] },
        })}
      />
    );
    const viewport = measuredViewport({
      scrollHeight: 1000,
      clientHeight: 100,
      scrollTop: 900,
    });
    fireEvent.scroll(viewport);

    rerender(
      <ChatPanel
        session={stubSession({
          generating: true,
          streaming: {
            messageId: 'msg-1',
            parts: [TEXT, { type: 'text', text: ' And then some.' }],
          },
        })}
      />
    );
    expect(viewport.scrollTop).toBe(1000);
  });
});
