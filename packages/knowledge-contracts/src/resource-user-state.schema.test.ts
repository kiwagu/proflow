import { describe, expect, it } from 'vitest';

import {
  KNOWLEDGE_ACTIVITY_BODY_SUBJECT,
  KNOWLEDGE_ACTIVITY_CONSUMER_NAME,
  KNOWLEDGE_ACTIVITY_STREAM_NAME,
  KNOWLEDGE_ACTIVITY_SUBJECT_FILTER,
  knowledgeActivityBodyEventSchema,
  openedRecordSchema,
  parseKnowledgeActivityBodyEvent,
  parseOpenedRecord,
  resourceUserStateSchema,
} from './resource-user-state.schema.js';

/**
 * Contract guards for the resource-activity boundary: the open-record
 * write body, the per-user `last_opened_at` roll-up field, and the NATS body
 * envelope shared by the producer (`Bodies.afterChange`) and the consumer worker.
 * No live broker — the envelope is the wire contract, validated in isolation.
 */

describe('openedRecordSchema', () => {
  it('round-trips a valid open record (only targeting keys, no identity)', () => {
    const parsed = openedRecordSchema.parse({
      spaceId: 'spc_abc',
      nodeId: 'knr_xyz',
    });
    expect(parsed).toEqual({ spaceId: 'spc_abc', nodeId: 'knr_xyz' });
  });

  it('rejects an empty spaceId / nodeId', () => {
    expect(parseOpenedRecord({ spaceId: '', nodeId: 'knr_xyz' }).success).toBe(
      false
    );
    expect(parseOpenedRecord({ spaceId: 'spc_abc', nodeId: '' }).success).toBe(
      false
    );
  });

  it('rejects a missing field', () => {
    expect(parseOpenedRecord({ spaceId: 'spc_abc' }).success).toBe(false);
  });
});

describe('resourceUserStateSchema.last_opened_at', () => {
  it('accepts an ISO datetime, null, or absence', () => {
    const base = {
      resource_id: 'knr_xyz',
      coarse_status: 'not_started',
    } as const;
    expect(
      resourceUserStateSchema.parse({
        ...base,
        last_opened_at: '2026-06-22T19:30:00.000Z',
      }).last_opened_at
    ).toBe('2026-06-22T19:30:00.000Z');
    expect(
      resourceUserStateSchema.parse({ ...base, last_opened_at: null })
        .last_opened_at
    ).toBeNull();
    expect('last_opened_at' in resourceUserStateSchema.parse({ ...base })).toBe(
      false
    );
  });

  it('rejects a non-datetime last_opened_at', () => {
    const result = resourceUserStateSchema.safeParse({
      resource_id: 'knr_xyz',
      coarse_status: 'not_started',
      last_opened_at: 'yesterday',
    });
    expect(result.success).toBe(false);
  });
});

describe('knowledgeActivityBodyEventSchema', () => {
  const valid = {
    event_id: '550e8400-e29b-41d4-a716-446655440000',
    node_id: 'knr_xyz',
    space_id: 'spc_abc',
    occurred_at: '2026-06-22T19:30:00.000Z',
  } as const;

  it('round-trips a valid body-edit envelope', () => {
    const parsed = knowledgeActivityBodyEventSchema.parse(valid);
    expect(parsed).toEqual(valid);
  });

  it('carries no user_id (a body edit is node activity, not a per-user open)', () => {
    const parsed = parseKnowledgeActivityBodyEvent(valid);
    expect(parsed.success).toBe(true);
    expect('user_id' in (parsed.success ? parsed.data : {})).toBe(false);
  });

  it('rejects a missing event_id (the JetStream dedupe key)', () => {
    const { event_id: _omit, ...rest } = valid;
    expect(parseKnowledgeActivityBodyEvent(rest).success).toBe(false);
  });

  it('rejects a non-datetime occurred_at', () => {
    expect(
      parseKnowledgeActivityBodyEvent({ ...valid, occurred_at: 'now' }).success
    ).toBe(false);
  });
});

describe('knowledge-activity stream/subject contract', () => {
  it('pins the stream, subject filter, body subject, and consumer name', () => {
    expect(KNOWLEDGE_ACTIVITY_STREAM_NAME).toBe('KNOWLEDGE_ACTIVITY');
    expect(KNOWLEDGE_ACTIVITY_SUBJECT_FILTER).toBe('knowledge.activity.v1.>');
    expect(KNOWLEDGE_ACTIVITY_BODY_SUBJECT).toBe('knowledge.activity.v1.body');
    expect(KNOWLEDGE_ACTIVITY_CONSUMER_NAME).toBe('author-activity-v1');
  });

  it('the body subject matches the stream filter wildcard', () => {
    const prefix = KNOWLEDGE_ACTIVITY_SUBJECT_FILTER.replace('>', '');
    expect(KNOWLEDGE_ACTIVITY_BODY_SUBJECT.startsWith(prefix)).toBe(true);
  });
});
