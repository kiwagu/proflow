# @workspace/workbench-agent

The page's side of the AI agent: the worker that runs the model loop, the
chat session that drives it, and the seam an editor plugs into.

The model loop is a database client, a model conversation and a sandbox —
none of which belongs on the thread that paints. It therefore runs in a Web
Worker beside the page, and this package is everything the page needs to
talk to it.

## What is here

| Module                   | Purpose                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `worker/start.ts`        | Starts the worker and returns the page's client for it.                                      |
| `worker/agent.worker.ts` | The worker's composition root: opens the local database, builds the ports, serves the agent. |
| `worker/composition.ts`  | Provider selection and the agent's dependencies over a set of ports.                         |
| `chat/session.ts`        | A chat session: create, resume, send, stop. Framework-free.                                  |
| `chat/turn.ts`           | One model turn — streamed to a callback, persisted to the transcript.                        |
| `chat/parts.ts`          | Provider chunks ⇄ renderable parts, and the stored transcript in the same shape.             |
| `editor/bridge.ts`       | The seam: what a live editor must answer for the agent to read from and write to it.         |
| `react/*`                | The React surface: `<AgentProvider>`, `useAgent`, `useEditorBridge`, `useChatSession`.       |

This package deliberately ships **no chat UI**. It exposes hooks and context;
a surface renders them.

## Using it

Start one worker per page in the composition root and provide it:

```tsx
const agent = startAgentWorker();
agent.configure({ provider: 'mock', apiKey: null });

<AgentProvider client={agent}>{children}</AgentProvider>;
```

A surface then opens a session — `null` opens a new chat, an id resumes one:

```tsx
const chat = useChatSession(
  { chats, chatList, messages, llm: useAgent().client, newId },
  chatId
);
```

`chat.messages` is the settled transcript, `chat.streaming` the turn in
flight, `chat.send(text)` runs a reply and `chat.stop()` interrupts it —
what arrived is kept and recorded as interrupted, not as an error.

## The editor seam

`EditorDocumentBridge` is what an editor implements so an AI edit starts
from what the user currently sees and lands in their undo stack. The
implementation lives beside the live editor and is not in this package —
this is only the shape of the answer:

```tsx
useEditorBridge({
  documentId: () => openDocumentId,
  readState: (id) =>
    id === openDocumentId ? editor.getEditorState().toJSON() : null,
  applyEdit: (id, result, partial) => {
    /* bring the live editor to result's state; false to decline */
  },
});
```

Until an editor registers, the agent gets `null`/`false` and falls back to
the document store: an edit still runs and still lands, it just lands
through storage rather than in the live editor.

## Provider access

The provider choice and key are pushed into the worker with
`client.configure(...)` and live only in its memory — the worker announces
itself again after a restart and the client re-sends them. A real provider
is used when a key is configured; the scripted local model otherwise, so
the whole loop is exercisable without a network.

## Tests

```
bun run --cwd packages/workbench-agent test
bun run --cwd packages/workbench-agent typecheck
bun run --cwd packages/workbench-agent lint:strict
```
