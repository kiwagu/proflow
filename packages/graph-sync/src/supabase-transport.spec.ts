import { describe, expect, it } from 'vitest';
import { createSupabaseGraphRowTransport } from './supabase-transport.js';
import { GraphWriteError } from './types.js';

/**
 * The transport's verdict logic against a recorded PostgREST client: what a
 * zero-row PATCH means, what an RPC error means. The stand-in suite covers
 * the protocol; this covers the one adapter seam the stand-in cannot — how
 * the real client's answers are read.
 */

type Answer = { data: unknown; error: unknown };

function fakeClient(answers: {
  update?: Answer;
  delete?: Answer;
  rpc?: Answer;
}) {
  const calls: { rpc: [string, unknown][] } = { rpc: [] };
  const terminal = (answer: Answer) => {
    const chain = {
      eq: () => chain,
      match: () => chain,
      select: () => Promise.resolve(answer),
      then: (resolve: (a: Answer) => void) => resolve(answer),
    };
    return chain;
  };
  const client = {
    from: () => ({
      update: () => terminal(answers.update ?? { data: [], error: null }),
      delete: () => terminal(answers.delete ?? { data: [], error: null }),
      upsert: () => Promise.resolve({ data: null, error: null }),
    }),
    schema: () => client,
    rpc: (fn: string, args: unknown) => {
      calls.rpc.push([fn, args]);
      return Promise.resolve(answers.rpc ?? { data: null, error: null });
    },
  };
  return { client, calls };
}

function transportWith(answers: Parameters<typeof fakeClient>[0]) {
  const { client, calls } = fakeClient(answers);
  return {
    transport: createSupabaseGraphRowTransport(
      client as unknown as Parameters<typeof createSupabaseGraphRowTransport>[0]
    ),
    calls,
  };
}

describe('supabase transport — write verdicts', () => {
  it('reads a PATCH that matched no row as a refusal', async () => {
    const { transport } = transportWith({ update: { data: [], error: null } });
    await expect(
      transport.write({
        kind: 'patch',
        table: 'knowledge_resources',
        match: { id: 'knr_x' },
        values: { title: 'x' },
      })
    ).rejects.toMatchObject({ failure: 'refused' });
  });

  it('accepts a PATCH that matched a row', async () => {
    const { transport } = transportWith({
      update: { data: [{ id: 'knr_x' }], error: null },
    });
    await expect(
      transport.write({
        kind: 'patch',
        table: 'knowledge_resources',
        match: { id: 'knr_x' },
        values: { title: 'x' },
      })
    ).resolves.toBeUndefined();
  });

  it('keeps a DELETE that matched nothing an idempotent success', async () => {
    const { transport } = transportWith({ delete: { data: [], error: null } });
    await expect(
      transport.write({
        kind: 'delete',
        table: 'knowledge_edges',
        match: { from_id: 'a', to_id: 'b', relation_type: 'contains' },
      })
    ).resolves.toBeUndefined();
  });

  it('sends an rpc write as one client.rpc call with its args', async () => {
    const { transport, calls } = transportWith({});
    await transport.write({
      kind: 'rpc',
      fn: 'move_knowledge_resource',
      args: {
        p_space_id: 's',
        p_node_id: 'n',
        p_target_parent_id: null,
        p_position: 0,
      },
    });
    expect(calls.rpc).toEqual([
      [
        'move_knowledge_resource',
        {
          p_space_id: 's',
          p_node_id: 'n',
          p_target_parent_id: null,
          p_position: 0,
        },
      ],
    ]);
  });

  it('classifies an rpc error by its code like any other write', async () => {
    const { transport } = transportWith({
      rpc: { data: null, error: { code: '42501', message: 'denied' } },
    });
    await expect(
      transport.write({ kind: 'rpc', fn: 'move_knowledge_resource', args: {} })
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof GraphWriteError && e.failure === 'refused'
    );
  });
});

describe('supabase transport — nudge channel state', () => {
  function channelClient() {
    let report: ((status: string) => void) | undefined;
    const channel = {
      on: () => channel,
      subscribe: (callback: (status: string) => void) => {
        report = callback;
        return channel;
      },
    };
    const client = {
      channel: () => channel,
      removeChannel: () => Promise.resolve('ok'),
    };
    return {
      transport: createSupabaseGraphRowTransport(
        client as unknown as Parameters<
          typeof createSupabaseGraphRowTransport
        >[0]
      ),
      report: (status: string) => report?.(status),
    };
  }

  it('says the channel is up only once it is subscribed, and down on an error, a timeout or a close', () => {
    const { transport, report } = channelClient();
    const states: boolean[] = [];
    const unsubscribe = transport.subscribe(
      'spc_0000000000000001.0000000000' as Parameters<
        typeof transport.subscribe
      >[0],
      {
        onChange: () => undefined,
        onDelete: () => undefined,
        onStatus: (up) => states.push(up),
      }
    );
    report('SUBSCRIBED');
    report('CHANNEL_ERROR');
    report('SUBSCRIBED');
    report('TIMED_OUT');
    report('CLOSED');
    expect(states).toEqual([true, false, true, false, false]);
    unsubscribe();
  });
});
