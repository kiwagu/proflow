import { describe, expect, it, vi } from 'vitest';
import {
  createChatSession,
  createNewChatSession,
  DEFAULT_CHAT_MODEL,
  openScratchChat,
  resumeChatSession,
  settleInterrupted,
} from './session';
import { fakeChats, fakeMessages, scriptedGateway, stableIds } from './testing';

function deps(overrides?: {
  chunks?: Parameters<typeof scriptedGateway>[0];
  hooks?: Parameters<typeof scriptedGateway>[1];
}) {
  const chats = fakeChats();
  const messages = fakeMessages();
  return {
    chats,
    chatList: chats,
    messages,
    llm: scriptedGateway(
      overrides?.chunks ?? [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: ', world' },
        { type: 'done' },
      ],
      overrides?.hooks
    ),
    newId: stableIds(),
  };
}

/** Settles when the session reports a state the predicate accepts. */
function until(
  session: {
    subscribe: (l: () => void) => () => void;
    getState: () => unknown;
  },
  predicate: (state: never) => boolean
): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (predicate(session.getState() as never)) {
        unsubscribe();
        resolve();
      }
    };
    const unsubscribe = session.subscribe(check);
    check();
  });
}

describe('a chat session', () => {
  it('records a send as a user message followed by the settled reply', async () => {
    const d = deps();
    const session = await createNewChatSession(d);

    await session.send('hi');

    const state = session.getState();
    expect(state.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'hi'],
      ['assistant', 'Hello, world'],
    ]);
    expect(state.generating).toBe(false);
    expect(state.streaming).toBeNull();
    expect(state.error).toBeNull();
    session.dispose();
  });

  it('coalesces the reply into one stored text part, not one per chunk', async () => {
    const d = deps();
    const session = await createNewChatSession(d);

    await session.send('hi');

    const assistant = d.messages.rows.find((row) => row.role === 'assistant');
    expect(assistant?.parts.map((p) => p.data)).toEqual([
      { type: 'text', text: 'Hello, world' },
    ]);
    session.dispose();
  });

  it('exposes the turn in flight as it streams, then drops it for the transcript', async () => {
    const seen: number[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const d = deps({
      chunks: [
        { type: 'text', text: 'one' },
        { type: 'text', text: 'two' },
        { type: 'done' },
      ],
      hooks: {
        onChunk: async (index) => {
          if (index === 1) await gate;
        },
      },
    });
    const session = await createNewChatSession(d);

    const sending = session.send('hi');
    await until(session, (state: never) => {
      const streaming = (state as { streaming: { parts: unknown[] } | null })
        .streaming;
      if (streaming) seen.push(streaming.parts.length);
      return streaming !== null && streaming.parts.length === 1;
    });

    // Mid-turn: the first chunk is visible live and the transcript still
    // holds only the user message — the reply has not been re-read yet.
    expect(session.getState().generating).toBe(true);
    expect(session.getState().streaming?.parts).toEqual([
      { type: 'text', text: 'one' },
    ]);
    expect(session.getState().messages.map((m) => m.role)).toEqual(['user']);

    release?.();
    await sending;

    expect(session.getState().streaming).toBeNull();
    expect(session.getState().messages.at(-1)?.text).toBe('onetwo');
    session.dispose();
  });

  it('keeps what arrived when the turn is stopped and marks it interrupted', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const d = deps({
      chunks: [
        { type: 'text', text: 'partial' },
        { type: 'text', text: ' never arrives' },
        { type: 'done' },
      ],
      hooks: {
        onChunk: async (index) => {
          if (index === 1) await gate;
        },
      },
    });
    const session = await createNewChatSession(d);

    const sending = session.send('hi');
    await until(
      session,
      (state: never) =>
        (state as { streaming: { parts: unknown[] } | null }).streaming?.parts
          .length === 1
    );
    session.stop();
    release?.();
    await sending;

    const assistant = session.getState().messages.at(-1);
    expect(assistant?.status).toBe('interrupted');
    // What arrived is kept; the mark is added for the reader, not stored.
    expect(assistant?.text).toBe('partial');
    expect(assistant?.parts[0]).toEqual({ type: 'text', text: 'partial' });
    expect(assistant?.parts.at(-1)).toEqual({
      type: 'text',
      text: expect.stringContaining('Interrupted') as unknown as string,
    });
    expect(d.messages.rows.at(-1)?.parts).toEqual([
      { idx: 0, type: 'text', data: { type: 'text', text: 'partial' } },
    ]);
    expect([...d.messages.streams.values()].at(-1)?.status).toBe('interrupted');
    session.dispose();
  });

  it('refuses a second send while one is generating', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const d = deps({
      chunks: [{ type: 'text', text: 'x' }, { type: 'done' }],
      hooks: {
        onChunk: async (index) => {
          if (index === 1) await gate;
        },
      },
    });
    const session = await createNewChatSession(d);

    const first = session.send('hi');
    await until(
      session,
      (state: never) => (state as { generating: boolean }).generating
    );
    await expect(session.send('again')).rejects.toThrow(/already generating/);

    release?.();
    await first;
    session.dispose();
  });

  it('sends the model the history, not just the latest line', async () => {
    const d = deps();
    const spy = vi.spyOn(d.llm, 'streamChat');
    const session = await createNewChatSession(d);

    await session.send('first');
    await session.send('second');

    expect(spy.mock.calls.at(-1)?.[0].messages).toEqual([
      { role: 'user', text: 'first' },
      { role: 'assistant', text: 'Hello, world' },
      { role: 'user', text: 'second' },
    ]);
    expect(spy.mock.calls.at(-1)?.[0].model).toBe(DEFAULT_CHAT_MODEL);
    session.dispose();
  });

  it('reports a failed reply as an error status without losing the question', async () => {
    const d = deps({
      chunks: [{ type: 'error', reason: 'provider_error' }],
    });
    const session = await createNewChatSession(d);

    await session.send('hi');

    const state = session.getState();
    expect(state.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(state.messages.at(-1)?.status).toBe('error');
    expect(state.generating).toBe(false);
    session.dispose();
  });

  it('stops a turn in flight when the session is disposed', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const d = deps({
      chunks: [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
        { type: 'done' },
      ],
      hooks: {
        onChunk: async (index) => {
          if (index === 1) await gate;
        },
      },
    });
    const session = await createNewChatSession(d);

    const sending = session.send('hi');
    await until(
      session,
      (state: never) =>
        (state as { streaming: { parts: unknown[] } | null }).streaming?.parts
          .length === 1
    );
    session.dispose();
    release?.();
    await sending;

    expect(d.messages.rows.at(-1)?.status).toBe('interrupted');
    expect(d.messages.rows.at(-1)?.text).toBe('a');
    await expect(session.send('again')).rejects.toThrow(/disposed/);
  });
});

describe('resuming', () => {
  it('settles a stream a closed tab left running', async () => {
    const d = deps();
    const chat = await d.chats.create('resumed');
    const chatId = chat._unsafeUnwrap().id;
    await d.messages.appendUserMessage({ id: 'u1', chatId, text: 'hi' });
    await d.messages.beginAssistantMessage({
      id: 'a1',
      chatId,
      model: 'mock/default',
    });
    await d.messages.appendPart({
      messageId: 'a1',
      chatId,
      part: { idx: 0, type: 'text', data: { type: 'text', text: 'half' } },
    });
    await d.messages.beginStream({ id: 's1', chatId, messageId: 'a1' });

    const session = await resumeChatSession(d, chatId);

    expect(d.messages.rows.find((r) => r.id === 'a1')?.status).toBe(
      'interrupted'
    );
    expect(d.messages.streams.get('s1')?.status).toBe('interrupted');
    await until(
      session,
      (state: never) => (state as { messages: unknown[] }).messages.length === 2
    );
    const assistant = session.getState().messages.at(-1);
    expect(assistant?.parts[0]).toEqual({ type: 'text', text: 'half' });
    session.dispose();
  });

  it('leaves a settled transcript alone', async () => {
    const d = deps();
    const session = await createNewChatSession(d);
    await session.send('hi');
    session.dispose();

    const chatId = d.messages.rows[0]!.chatId;
    await settleInterrupted(d.messages, chatId);

    expect(d.messages.rows.map((r) => r.status)).toEqual([
      'complete',
      'complete',
    ]);
  });

  it('opens the most recent chat, and creates one only the first time', async () => {
    const d = deps();

    const first = await openScratchChat(d.chats, d.chatList);
    const again = await openScratchChat(d.chats, d.chatList);

    expect(again).toBe(first);
  });
});

describe('a session on a chat that cannot be read', () => {
  it('surfaces the failure instead of rendering an empty transcript', async () => {
    const d = deps();
    d.messages.listByChat = async () =>
      ({
        isErr: () => true,
        isOk: () => false,
        error: 'database closed',
      }) as never;

    const session = createChatSession(d, 'chat-missing');
    await until(
      session,
      (state: never) => (state as { error: string | null }).error !== null
    );

    expect(session.getState().error).toBe('database closed');
    expect(session.getState().messages).toEqual([]);
    session.dispose();
  });
});
