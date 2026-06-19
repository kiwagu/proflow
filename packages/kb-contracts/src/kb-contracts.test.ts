import { describe, expect, it } from 'vitest';

import {
  embedStatusSchema,
  parseResourceActivity,
  parseResourceDescription,
  parseResourceEmbedding,
  parseResourceLink,
  parseResourceMediaMeta,
  parseResourceProvenance,
  provenanceSourceSchema,
} from './index.js';

/**
 * Shape tests for the KB application-data satellite contracts. Each schema mirrors
 * the corresponding `kb.*` table row and its CHECK constraint; these tests keep the
 * zod contract and the migration in lock-step (a closed enum here must equal the
 * DB CHECK there).
 */

describe('resourceDescriptionSchema', () => {
  it('accepts a description row', () => {
    const r = parseResourceDescription({ node_id: 'knr_x', body: 'hello' });
    expect(r.success).toBe(true);
  });

  it('rejects a non-string body', () => {
    const r = parseResourceDescription({ node_id: 'knr_x', body: 42 });
    expect(r.success).toBe(false);
  });
});

describe('resourceProvenanceSchema', () => {
  it('mirrors the DB CHECK enum (human/imported/ai)', () => {
    expect(provenanceSourceSchema.options).toEqual(['human', 'imported', 'ai']);
  });

  it('accepts a valid source', () => {
    const r = parseResourceProvenance({ node_id: 'knr_x', source: 'ai' });
    expect(r.success).toBe(true);
  });

  it('rejects an out-of-set source', () => {
    const r = parseResourceProvenance({ node_id: 'knr_x', source: 'robot' });
    expect(r.success).toBe(false);
  });
});

describe('resourceActivitySchema', () => {
  it('accepts a non-negative integer view_count', () => {
    const r = parseResourceActivity({ node_id: 'knr_x', view_count: 1280 });
    expect(r.success).toBe(true);
  });

  it('rejects a negative view_count', () => {
    const r = parseResourceActivity({ node_id: 'knr_x', view_count: -1 });
    expect(r.success).toBe(false);
  });
});

describe('resourceLinkSchema', () => {
  it('accepts a url with optional host', () => {
    const r = parseResourceLink({
      node_id: 'knr_x',
      url: 'https://status.acme.com',
      host: 'status.acme.com',
    });
    expect(r.success).toBe(true);
  });

  it('rejects a non-url', () => {
    const r = parseResourceLink({ node_id: 'knr_x', url: 'not a url' });
    expect(r.success).toBe(false);
  });
});

describe('resourceMediaMetaSchema', () => {
  it('accepts file/video meta fields', () => {
    const r = parseResourceMediaMeta({
      node_id: 'knr_x',
      byte_size: 2_400_000,
      duration_ms: 760_000,
      mime_type: 'application/pdf',
    });
    expect(r.success).toBe(true);
  });

  it('accepts a node with no media fields set', () => {
    const r = parseResourceMediaMeta({ node_id: 'knr_x' });
    expect(r.success).toBe(true);
  });

  it('rejects a negative byte_size', () => {
    const r = parseResourceMediaMeta({ node_id: 'knr_x', byte_size: -5 });
    expect(r.success).toBe(false);
  });
});

describe('resourceEmbeddingSchema', () => {
  it('mirrors the DB CHECK enum (indexed/stale/indexing)', () => {
    expect(embedStatusSchema.options).toEqual(['indexed', 'stale', 'indexing']);
  });

  it('accepts a valid status', () => {
    const r = parseResourceEmbedding({ node_id: 'knr_x', status: 'stale' });
    expect(r.success).toBe(true);
  });

  it('rejects an out-of-set status', () => {
    const r = parseResourceEmbedding({ node_id: 'knr_x', status: 'done' });
    expect(r.success).toBe(false);
  });
});
