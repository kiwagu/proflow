/**
 * Tool calls in the transcript.
 *
 * A call and its result are one event to the reader and two parts on the
 * wire, so the assertions here are mostly about the seam between those two
 * facts: the pair must collapse into a single card keyed by the call's id,
 * a call still in flight must say so, a failure must show its message, and
 * a large result must not be pasted into the transcript whole.
 */
import type { AssistantPart } from '@workspace/workbench-agent';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '../../test-utils';
import { ChatPanel } from './chat.panel';
import { stubSession } from './chat.testing';

function call(id: string, name = 'ListFiles'): AssistantPart {
  return { type: 'tool-call', id, name, input: { path: '/' } };
}
function result(
  id: string,
  output: unknown,
  name = 'ListFiles'
): AssistantPart {
  return { type: 'tool-result', id, name, output };
}
function failure(
  id: string,
  message: string,
  name = 'ListFiles'
): AssistantPart {
  return { type: 'tool-error', id, name, message };
}

function renderParts(parts: AssistantPart[]) {
  return render(
    <ChatPanel
      session={stubSession({
        messages: [
          {
            id: 'msg-1',
            role: 'assistant',
            text: '',
            parts,
            status: 'complete',
          },
        ],
      })}
    />
  );
}

function cards(): HTMLElement[] {
  return screen.queryAllByTestId('chat-tool');
}

describe('a tool call in the transcript', () => {
  it('shows a call and its result as one card, with the output collapsed', () => {
    renderParts([call('call-1'), result('call-1', { entries: ['a.md'] })]);

    expect(cards()).toHaveLength(1);
    expect(cards()[0]?.dataset.state).toBe('done');
    expect(screen.getByText('ListFiles')).toBeDefined();
    // Collapsed means the payload is not in the document at all, not merely
    // styled away: jsdom computes no styles, so a spec that asserted
    // visibility would pass either way.
    expect(screen.queryByTestId('chat-tool-output-body')).toBeNull();

    fireEvent.click(screen.getByTestId('chat-tool-output-trigger'));
    expect(screen.getByTestId('chat-tool-output-body').textContent).toContain(
      'a.md'
    );
  });

  it('marks a call with no result yet as still running', () => {
    renderParts([call('call-1')]);

    expect(cards()).toHaveLength(1);
    expect(cards()[0]?.dataset.state).toBe('running');
  });

  it('shows the failure message when the call errored', () => {
    renderParts([call('call-1'), failure('call-1', 'the tool refused')]);

    expect(cards()[0]?.dataset.state).toBe('failed');
    // The message is plain visible text, not hidden behind a disclosure:
    // it is the reason the turn went the way it did.
    expect(screen.getByTestId('chat-tool-error').textContent).toContain(
      'the tool refused'
    );
  });

  it('pairs each result with its own call, not with the tool name', () => {
    // Two calls of the SAME tool, one answered. Keyed by name they would
    // read as a single card that already finished — which is exactly the
    // lie the id is there to prevent.
    renderParts([
      call('call-1'),
      call('call-2'),
      result('call-2', { entries: [] }),
    ]);

    expect(cards().map((card) => card.dataset.state)).toEqual([
      'running',
      'done',
    ]);
  });

  it('truncates a large output and says how much it withheld', () => {
    const long = 'x'.repeat(5000);
    renderParts([call('call-1'), result('call-1', long)]);

    fireEvent.click(screen.getByTestId('chat-tool-output-trigger'));
    const shown = screen.getByTestId('chat-tool-output-body').textContent ?? '';
    expect(shown.length).toBe(2000);
    // 5002 characters of JSON (the string plus its quotes), 2000 shown.
    expect(screen.getByTestId('chat-tool-output-more').textContent).toContain(
      '3002'
    );
  });
});
