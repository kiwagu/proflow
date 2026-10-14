import { entityIdRegistry, type WriterId } from '@workspace/entity-id';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MalformedServerRowError } from './index.js';
import { createSupabaseTransport } from './supabase-transport.js';
import { createReplica, DOC_ID, SPACE_ID } from './testing/replica.js';
import {
  createServerStandIn,
  type ServerStandIn,
} from './testing/server-stand-in.js';
import { createSpaceReplica } from './testing/space-replica.js';
import type { SpacePassOutcome } from './document-sync.js';

/**
 * Ids enter the engine from the server, and that is where they are checked:
 * a head names a document, a log row names the writer that pushed it. A
 * malformed one is refused with an error that names it, and nothing it came
 * with is applied — inside the engine ids are typed from then on.
 */

const { documentIdFactory, writerIdFactory, knowledgeResourceIdFactory } =
  entityIdRegistry.factories;

const blob = (text: string) => new TextEncoder().encode(text);

let server: ServerStandIn;

beforeEach(async () => {
  server = await createServerStandIn();
});
afterEach(async () => {
  await server.close();
});

describe('server rows are parsed at the transport', () => {
  it('refuses a log row whose writer is not a writer id, and applies nothing', async () => {
    const author = await createReplica('author', server);
    await author.edit('hello');
    await author.push();
    await server.resend(DOC_ID, blob('x'), 'tab-1' as WriterId);

    const reader = await createReplica('reader', server);
    const failure = await reader.pull().catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(MalformedServerRowError);
    expect(String((failure as Error).message)).toContain('writer "tab-1"');
    expect(reader.text()).toBe('');
    expect((await reader.ledger()).pulledSeq).toBe(0);
    await author.close();
    await reader.close();
  });

  it('refuses a head whose document id is malformed, and pulls nothing in that pass', async () => {
    const broken = documentIdFactory.brand('doc_space_spec_000a');
    await server.ensureDocument(
      broken,
      SPACE_ID,
      knowledgeResourceIdFactory.brand('knr_0000000000000001.0000000000')
    );
    await server.pushUpdate(broken, blob('x'), writerIdFactory.create());

    const replica = await createSpaceReplica('reader', server);
    const errors: unknown[] = [];
    const passes: SpacePassOutcome[] = [];
    const watch = replica.watchSpace({
      onError: (error) => errors.push(error),
      onPass: (outcome) => passes.push(outcome),
    });
    await expect.poll(() => errors.length).toBeGreaterThan(0);
    watch.stop();

    expect(errors[0]).toBeInstanceOf(MalformedServerRowError);
    expect(String((errors[0] as Error).message)).toContain(
      'crdt_documents.id "doc_space_spec_000a"'
    );
    expect(passes).toEqual([]);
    expect(await replica.headsCursor()).toBeNull();
    await replica.close();
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

  it('refuses a malformed head from PostgREST', async () => {
    const transport = clientAnswering([
      { id: 'doc_x', head_seq: 1, updated_at: new Date().toISOString() },
    ]);
    await expect(transport.heads(SPACE_ID, null, 10, 0)).rejects.toThrow(
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

  it('hands back canonical ids', async () => {
    const writer = writerIdFactory.create();
    const transport = clientAnswering([
      {
        seq: 1,
        bytes: '\\x00',
        writer: writer.toUpperCase().replace('WRT_', 'wrt_'),
      },
    ]);
    const [row] = await transport.tail(DOC_ID, 0);
    expect(row?.writer).toBe(writer);
  });

  it('types its parameters as ids of their kind', () => {
    const transport = clientAnswering([]);
    // @ts-expect-error a plain string is not a document id
    void transport.tail('doc_x', 0);
    void transport.tail(DOC_ID, 0);
  });
});
