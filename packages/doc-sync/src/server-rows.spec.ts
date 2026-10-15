import { entityIdRegistry, type WriterId } from '@workspace/entity-id';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MalformedServerRowError } from './index.js';
import { createSupabaseTransport } from './supabase-transport.js';
import { createReplica, DOC_ID, SPACE_ID } from './testing/replica.js';
import {
  createServerStandIn,
  type ServerStandIn,
} from './testing/server-stand-in.js';
import { createSpaceReplica } from './testing/space-replica.js';
import type { DocumentRefusal, SpacePassOutcome } from './document-sync.js';

/**
 * Ids enter the engine from the server, and that is where they are checked:
 * a head names a document, a log row names the writer that pushed it. What
 * cannot be taken in is refused for its own document only — the pass goes
 * on with the others and the space cursor moves — and it is reported once.
 * A writer is only ever compared, so it is checked by its `wrt_` head alone.
 */

const { documentIdFactory, writerIdFactory, knowledgeResourceIdFactory } =
  entityIdRegistry.factories;

const DOC_A = documentIdFactory.brand('doc_000000000000000a.0000000000');
const DOC_B = documentIdFactory.brand('doc_000000000000000b.0000000000');
const blob = (text: string) => new TextEncoder().encode(text);

let server: ServerStandIn;

beforeEach(async () => {
  server = await createServerStandIn();
});
afterEach(async () => {
  await server.close();
});

describe('server rows are parsed at the transport', () => {
  it('a writer that fails the wrt_ gate refuses that document once; the next one syncs and the cursor moves', async () => {
    const author = await createSpaceReplica('author', server);
    await author.edit(DOC_A, 'alpha');
    await author.push(DOC_A);
    await server.resend(DOC_A, blob('x'), 'tab-1' as WriterId);
    await author.edit(DOC_B, 'beta');
    await author.push(DOC_B);

    const refusals: DocumentRefusal[] = [];
    const passes: SpacePassOutcome[] = [];
    const reader = await createSpaceReplica('reader', server, {
      onRefused: (refusal) => refusals.push(refusal),
    });
    const watch = reader.watchSpace({ onPass: (o) => passes.push(o) });
    await expect.poll(() => reader.text(DOC_B)).toBe('beta');
    // Pass after pass meets the same refused document.
    for (const expected of [2, 3, 4]) {
      watch.kick({ full: true });
      await expect.poll(() => passes.length).toBe(expected);
    }
    watch.stop();

    expect(reader.text(DOC_A)).toBe('');
    expect(refusals).toHaveLength(1);
    expect(refusals[0]?.documentId).toBe(DOC_A);
    expect(refusals[0]?.error).toBeInstanceOf(MalformedServerRowError);
    expect(String(refusals[0]?.error.message)).toContain(
      'crdt_updates.writer "tab-1"'
    );
    expect(await reader.headsCursor()).not.toBeNull();
    await author.close();
    await reader.close();
  });

  it('takes in a row whose writer has the wrt_ head but not the canonical tail', async () => {
    const author = await createReplica('author', server);
    await author.edit('hello');
    await author.push();
    const [row] = await server.tail(DOC_ID, 0);
    await server.resend(DOC_ID, row!.bytes, 'wrt_Legacy-Writer' as WriterId);

    const reader = await createReplica('reader', server);
    const result = await reader.pull();

    expect(result.imported).toBe(2);
    expect(reader.text()).toBe('hello');
    await author.close();
    await reader.close();
  });

  it('skips a head whose document id is malformed, reports it once, and syncs the document after it', async () => {
    const broken = documentIdFactory.brand('doc_space_spec_000a');
    await server.ensureDocument(
      broken,
      SPACE_ID,
      knowledgeResourceIdFactory.brand('knr_0000000000000001.0000000000')
    );
    await server.pushUpdate(broken, blob('x'), writerIdFactory.create());
    const author = await createSpaceReplica('author', server);
    await author.edit(DOC_B, 'beta');
    await author.push(DOC_B);

    const refusals: DocumentRefusal[] = [];
    const passes: SpacePassOutcome[] = [];
    const errors: unknown[] = [];
    const reader = await createSpaceReplica('reader', server, {
      onRefused: (refusal) => refusals.push(refusal),
    });
    const watch = reader.watchSpace({
      onPass: (o) => passes.push(o),
      onError: (e) => errors.push(e),
    });
    await expect.poll(() => reader.text(DOC_B)).toBe('beta');
    for (const expected of [2, 3, 4]) {
      watch.kick({ full: true });
      await expect.poll(() => passes.length).toBe(expected);
    }
    watch.stop();

    expect(errors).toEqual([]);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]?.documentId).toBe('doc_space_spec_000a');
    expect(String(refusals[0]?.error.message)).toContain(
      'crdt_documents.id "doc_space_spec_000a"'
    );
    expect(await reader.headsCursor()).not.toBeNull();
    await author.close();
    await reader.close();
  });
});

describe('the production transport parses the same way', () => {
  function clientAnswering(data: unknown[]) {
    const answer = { data, error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'gt', 'gte', 'order', 'range'])
      chain[method] = () => chain;
    chain['then'] = (resolve: (a: typeof answer) => void) => resolve(answer);
    return createSupabaseTransport({
      from: () => chain,
    } as unknown as Parameters<typeof createSupabaseTransport>[0]);
  }

  it('refuses a malformed head from PostgREST and keeps the others', async () => {
    const at = new Date().toISOString();
    const transport = clientAnswering([
      { id: DOC_A, head_seq: 1, updated_at: at },
      { id: 'doc_x', head_seq: 1, updated_at: at },
    ]);
    const page = await transport.heads(SPACE_ID, null, 10, 0);
    expect(page.rows.map((head) => head.docId)).toEqual([DOC_A]);
    expect(page.refused.map((head) => head.id)).toEqual(['doc_x']);
    expect(String(page.refused[0]?.error.message)).toMatch(
      /crdt_documents\.id "doc_x"/
    );
  });

  it('refuses a log row with a malformed writer from PostgREST', async () => {
    const transport = clientAnswering([
      { seq: 1, bytes: '\\x00', writer: 'agent-worker' },
    ]);
    await expect(transport.tail(DOC_ID, 0)).rejects.toThrow(
      /crdt_updates\.writer "agent-worker"/
    );
  });

  it('refuses a head whose document id is not canonical instead of rewriting it', async () => {
    const at = new Date().toISOString();
    const transport = clientAnswering([
      { id: 'doc_000000000000000A.0000000000', head_seq: 1, updated_at: at },
    ]);
    const page = await transport.heads(SPACE_ID, null, 10, 0);
    expect(page.rows).toEqual([]);
    expect(page.refused.map((head) => head.id)).toEqual([
      'doc_000000000000000A.0000000000',
    ]);
  });

  it('takes a writer by its wrt_ head, as the server holds it', async () => {
    const transport = clientAnswering([
      { seq: 1, bytes: '\\x00', writer: 'wrt_Legacy-Writer' },
    ]);
    const [row] = await transport.tail(DOC_ID, 0);
    expect(row?.writer).toBe('wrt_Legacy-Writer');
  });

  it('types its parameters as ids of their kind', () => {
    const transport = clientAnswering([]);
    // @ts-expect-error a plain string is not a document id
    void transport.tail('doc_x', 0);
    void transport.tail(DOC_ID, 0);
  });
});

describe('the production transport opens no channel', () => {
  it("offers no space subscription: change signals are the composition's", () => {
    const channel = vi.fn();
    const transport = createSupabaseTransport({
      channel,
    } as unknown as Parameters<typeof createSupabaseTransport>[0]);
    expect('subscribeSpace' in transport).toBe(false);
    expect(channel).not.toHaveBeenCalled();
  });

  it('has no per-document nudge any more', () => {
    const transport = createSupabaseTransport(
      {} as unknown as Parameters<typeof createSupabaseTransport>[0]
    );
    expect('subscribeInserts' in transport).toBe(false);
  });
});
