import type { z } from 'zod';
import { describe, expect, it } from 'vitest';

import {
  BODY_BRIDGE_EVENTS,
  BODY_BRIDGE_SCHEMA_VERSION,
  bodyBridgeEnvelopeSchema,
  bodyRefSchema,
  parseBodyBridgeEnvelope,
} from './body-bridge.schema.js';

type EnvelopeInput = z.input<typeof bodyBridgeEnvelopeSchema>;

/**
 * Round-trip the two bridge envelopes the fan-out emits (mirror of
 * `projection.schema.test.ts`). These are the exact jsonb shapes the outbox row
 * carries, so parsing them here keeps the durable payload and the contract in
 * lock-step — the future JetStream consumer parses the identical envelope.
 */

const linked = {
  schema_version: 1,
  event: 'body.linked',
  space_id: 'spc_abc',
  node_id: 'knr_xyz',
  body_ref: { collection: 'bodies', doc_id: '665f0c3a1b2c3d4e5f001122' },
} as const;

const unlinked = {
  schema_version: 1,
  event: 'body.unlinked',
  space_id: 'spc_abc',
  node_id: 'knr_xyz',
} as const;

describe('bodyBridgeEnvelopeSchema', () => {
  it('round-trips a body.linked envelope (carries the body_ref)', () => {
    const parsed = bodyBridgeEnvelopeSchema.parse(linked);
    expect(parsed).toEqual(linked);
    expect(parsed.event).toBe('body.linked');
    if (parsed.event === 'body.linked') {
      expect(parsed.body_ref.collection).toBe('bodies');
      expect(parsed.body_ref.doc_id).toBe(linked.body_ref.doc_id);
    }
  });

  it('round-trips a body.unlinked envelope (no body_ref)', () => {
    const parsed = bodyBridgeEnvelopeSchema.parse(unlinked);
    expect(parsed).toEqual(unlinked);
    expect(parsed.event).toBe('body.unlinked');
    expect('body_ref' in parsed).toBe(false);
  });

  it('exposes the pinned schema version + event list', () => {
    expect(BODY_BRIDGE_SCHEMA_VERSION).toBe(1);
    expect(linked.schema_version).toBe(BODY_BRIDGE_SCHEMA_VERSION);
    expect(BODY_BRIDGE_EVENTS).toEqual(['body.linked', 'body.unlinked']);
  });

  it('rejects body.linked missing a body_ref (discriminated union guard)', () => {
    const result = parseBodyBridgeEnvelope({
      schema_version: 1,
      event: 'body.linked',
      space_id: 'spc_abc',
      node_id: 'knr_xyz',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown event', () => {
    const result = parseBodyBridgeEnvelope({
      ...unlinked,
      event: 'body.updated',
    } as unknown as EnvelopeInput);
    expect(result.success).toBe(false);
  });

  it('rejects a wrong schema_version', () => {
    const result = parseBodyBridgeEnvelope({ ...unlinked, schema_version: 2 });
    expect(result.success).toBe(false);
  });

  it('rejects a body_ref pointing at a non-bodies collection', () => {
    const result = bodyRefSchema.safeParse({
      collection: 'media',
      doc_id: 'x',
    });
    expect(result.success).toBe(false);
  });
});
