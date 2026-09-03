import type { AgentConfig, EditOutcome } from '@workspace/ai-agent';
import type { ILlmGateway, LlmChunk } from '@workspace/domain';
import type { SerializedEditorState } from 'lexical';
import { describe, expect, it } from 'vitest';
import {
  createEditorBridgeRegistry,
  type EditorDocumentBridge,
  openDocumentHooks,
} from '../editor/bridge';
import { createBridgeHarness } from './harness';

function gateway(chunks: LlmChunk[]): ILlmGateway {
  return {
    streamChat(request) {
      return {
        async *[Symbol.asyncIterator]() {
          for (const chunk of chunks) {
            if (request.signal?.aborted) return;
            yield chunk;
          }
        },
      };
    },
  };
}

const state = (text: string) =>
  ({
    root: { type: 'root', children: [{ type: 'text', text }] },
  }) as unknown as SerializedEditorState;

const outcome = (text: string) =>
  ({ ops: [], state: state(text) }) as unknown as EditOutcome;

function bridgeFor(documentId: string): EditorDocumentBridge & {
  applied: { documentId: string; partial: boolean }[];
} {
  const applied: { documentId: string; partial: boolean }[] = [];
  return {
    applied,
    documentId: () => documentId,
    readState: (id) => (id === documentId ? state('live') : null),
    applyEdit: (id, _result, partial) => {
      if (id !== documentId) return false;
      applied.push({ documentId: id, partial });
      return true;
    },
  };
}

const CONFIG: AgentConfig = { provider: 'mock', apiKey: null };

describe('the page↔worker bridge', () => {
  it('streams a chat turn from the worker end to the page end', async () => {
    const harness = createBridgeHarness({
      gatewayFor: () =>
        gateway([
          { type: 'text', text: 'from ' },
          { type: 'text', text: 'the worker' },
          { type: 'done' },
        ]),
      editFor: () => async () => outcome('unused'),
    });
    harness.client.configure(CONFIG);

    const chunks: LlmChunk[] = [];
    for await (const chunk of harness.client.streamChat({
      model: 'mock/default',
      messages: [{ role: 'user', text: 'hi' }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: 'text', text: 'from ' },
      { type: 'text', text: 'the worker' },
      { type: 'done' },
    ]);
    harness.close();
  });

  it('keeps two concurrent turns on their own streams', async () => {
    const harness = createBridgeHarness({
      gatewayFor: () => ({
        streamChat(request) {
          const tag = request.messages[0]?.text ?? '?';
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: 'text', text: tag } as LlmChunk;
              yield { type: 'done' } as LlmChunk;
            },
          };
        },
      }),
      editFor: () => async () => outcome('unused'),
    });
    harness.client.configure(CONFIG);

    const collect = async (text: string) => {
      const out: string[] = [];
      for await (const chunk of harness.client.streamChat({
        model: 'mock/default',
        messages: [{ role: 'user', text }],
      })) {
        if (chunk.type === 'text') out.push(chunk.text);
      }
      return out;
    };

    const [a, b] = await Promise.all([collect('alpha'), collect('beta')]);

    expect(a).toEqual(['alpha']);
    expect(b).toEqual(['beta']);
    harness.close();
  });

  it('carries an edit request across and its outcome back', async () => {
    const harness = createBridgeHarness({
      gatewayFor: () => gateway([{ type: 'done' }]),
      editFor:
        () =>
        async ({ documentId, prompt }) =>
          outcome(`${documentId}:${prompt}`),
    });
    harness.client.configure(CONFIG);

    const result = await harness.client.editDocument({
      documentId: 'doc-1',
      prompt: 'make it shorter',
    });

    expect(
      (result.state as unknown as { root: { children: { text: string }[] } })
        .root.children[0]?.text
    ).toBe('doc-1:make it shorter');
    harness.close();
  });

  it('rejects an edit the worker could not run, with its reason', async () => {
    const harness = createBridgeHarness({
      gatewayFor: () => gateway([{ type: 'done' }]),
      editFor: () => async () => {
        throw new Error('document has no content');
      },
    });
    harness.client.configure(CONFIG);

    await expect(
      harness.client.editDocument({ documentId: 'doc-1', prompt: 'x' })
    ).rejects.toThrow('document has no content');
    harness.close();
  });

  it('lets the worker read the live editor through the registered bridge', async () => {
    const registry = createEditorBridgeRegistry();
    let seen: SerializedEditorState | null | undefined;
    const harness = createBridgeHarness({
      gatewayFor: () => gateway([{ type: 'done' }]),
      editFor:
        (_config, page) =>
        async ({ documentId }) => {
          seen = await page.readState(documentId);
          return outcome('edited');
        },
    });
    harness.client.setOpenDocumentHooks(openDocumentHooks(registry.current));
    harness.client.configure(CONFIG);
    registry.register(bridgeFor('doc-1'));

    await harness.client.editDocument({ documentId: 'doc-1', prompt: 'x' });

    expect(
      (seen as unknown as { root: { children: { text: string }[] } } | null)
        ?.root.children[0]?.text
    ).toBe('live');
    harness.close();
  });

  it('answers null for a document no registered editor holds', async () => {
    const registry = createEditorBridgeRegistry();
    let seen: SerializedEditorState | null | undefined = state('sentinel');
    const harness = createBridgeHarness({
      gatewayFor: () => gateway([{ type: 'done' }]),
      editFor:
        (_config, page) =>
        async ({ documentId }) => {
          seen = await page.readState(documentId);
          return outcome('edited');
        },
    });
    harness.client.setOpenDocumentHooks(openDocumentHooks(registry.current));
    harness.client.configure(CONFIG);
    registry.register(bridgeFor('doc-1'));

    await harness.client.editDocument({ documentId: 'doc-OTHER', prompt: 'x' });

    expect(seen).toBeNull();
    harness.close();
  });

  it('reports an unapplied edit back to the worker so it can fall back to storage', async () => {
    const registry = createEditorBridgeRegistry();
    const applies: boolean[] = [];
    const harness = createBridgeHarness({
      gatewayFor: () => gateway([{ type: 'done' }]),
      editFor:
        (_config, page) =>
        async ({ documentId }) => {
          applies.push(await page.applyEdit(documentId, outcome('a'), true));
          return outcome('edited');
        },
    });
    harness.client.setOpenDocumentHooks(openDocumentHooks(registry.current));
    harness.client.configure(CONFIG);

    // No editor registered at all.
    await harness.client.editDocument({ documentId: 'doc-1', prompt: 'x' });
    expect(applies).toEqual([false]);

    // An editor holding a different document is equally not a target.
    registry.register(bridgeFor('doc-other'));
    await harness.client.editDocument({ documentId: 'doc-1', prompt: 'x' });
    expect(applies).toEqual([false, false]);

    // The editor that holds it takes the edit.
    registry.register(bridgeFor('doc-1'));
    await harness.client.editDocument({ documentId: 'doc-1', prompt: 'x' });
    expect(applies).toEqual([false, false, true]);
    harness.close();
  });

  it('configures the worker before the first turn reaches it', async () => {
    const configured: AgentConfig[] = [];
    const chunks: LlmChunk[] = [];
    const harness = createBridgeHarness({
      gatewayFor: (config) => {
        configured.push(config);
        return gateway([{ type: 'text', text: 'ok' }, { type: 'done' }]);
      },
      editFor: () => async () => outcome('unused'),
    });
    // Configured and sent in the same tick the client is created: the worker
    // has not announced itself yet, so both must wait for it. A turn that
    // overtook the configuration would be served an unconfigured gateway and
    // come back as an error chunk.
    harness.client.configure({ provider: 'anthropic', apiKey: 'k' });
    for await (const chunk of harness.client.streamChat({
      model: 'anthropic/x',
      messages: [],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([{ type: 'text', text: 'ok' }, { type: 'done' }]);
    expect(configured.at(-1)).toEqual({ provider: 'anthropic', apiKey: 'k' });
    harness.close();
  });

  it('applies the latest configuration to a later turn', async () => {
    const configured: AgentConfig[] = [];
    const harness = createBridgeHarness({
      gatewayFor: (config) => {
        configured.push(config);
        return gateway([{ type: 'done' }]);
      },
      editFor: () => async () => outcome('unused'),
    });
    harness.client.configure({ provider: 'mock', apiKey: null });
    for await (const _ of harness.client.streamChat({
      model: 'mock/default',
      messages: [],
    }));

    harness.client.configure({ provider: 'anthropic', apiKey: 'k' });
    for await (const _ of harness.client.streamChat({
      model: 'anthropic/x',
      messages: [],
    }));

    expect(configured.at(-1)).toEqual({ provider: 'anthropic', apiKey: 'k' });
    harness.close();
  });
});

describe('the editor bridge registry', () => {
  it('replaces a registration rather than stacking it', () => {
    const registry = createEditorBridgeRegistry();
    registry.register(bridgeFor('first'));
    registry.register(bridgeFor('second'));

    expect(registry.current()?.documentId()).toBe('second');
  });

  it('does not let a stale disposer clear the editor that replaced it', () => {
    const registry = createEditorBridgeRegistry();
    const disposeFirst = registry.register(bridgeFor('first'));
    registry.register(bridgeFor('second'));

    // Mount-before-unmount ordering under a route change: the outgoing
    // editor's cleanup runs after the incoming one has registered.
    disposeFirst();

    expect(registry.current()?.documentId()).toBe('second');
  });

  it('clears the registration when the current editor disposes', () => {
    const registry = createEditorBridgeRegistry();
    const dispose = registry.register(bridgeFor('only'));

    dispose();

    expect(registry.current()).toBeUndefined();
    const hooks = openDocumentHooks(registry.current);
    expect(hooks.readState('only')).toBeNull();
    expect(hooks.applyEdit('only', outcome('x'), false)).toBe(false);
  });
});
