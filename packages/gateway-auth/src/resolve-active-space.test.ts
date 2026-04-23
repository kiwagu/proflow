import { describe, expect, it } from 'vitest';

import { resolveActiveSpaceDecision } from './resolve-active-space';

describe('resolveActiveSpaceDecision', () => {
  it('returns none when no memberships', () => {
    const r = resolveActiveSpaceDecision({
      memberships: [],
      cookieSpaceId: undefined,
      querySpaceSlug: undefined,
      queryResolvesToSpaceId: undefined,
      defaultSpaceId: undefined,
    });
    expect(r.kind).toBe('none');
  });

  it('auto-selects single space', () => {
    const r = resolveActiveSpaceDecision({
      memberships: [{ space_id: 'spc_a', status: 'active' }],
      cookieSpaceId: undefined,
      querySpaceSlug: undefined,
      queryResolvesToSpaceId: undefined,
      defaultSpaceId: undefined,
    });
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.spaceId).toBe('spc_a');
      expect(r.resolution).toBe('single_auto');
    }
  });

  it('prefers query when valid', () => {
    const r = resolveActiveSpaceDecision({
      memberships: [
        { space_id: 'spc_a', status: 'active' },
        { space_id: 'spc_b', status: 'active' },
      ],
      cookieSpaceId: 'spc_b',
      querySpaceSlug: 'alpha',
      queryResolvesToSpaceId: 'spc_a',
      defaultSpaceId: 'spc_b',
    });
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.spaceId).toBe('spc_a');
      expect(r.resolution).toBe('from_query');
    }
  });

  it('uses cookie when multi and query missing', () => {
    const r = resolveActiveSpaceDecision({
      memberships: [
        { space_id: 'spc_a', status: 'active' },
        { space_id: 'spc_b', status: 'active' },
      ],
      cookieSpaceId: 'spc_b',
      querySpaceSlug: undefined,
      queryResolvesToSpaceId: undefined,
      defaultSpaceId: 'spc_a',
    });
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.spaceId).toBe('spc_b');
      expect(r.resolution).toBe('from_cookie');
    }
  });

  it('uses provided default when multi and no cookie/query', () => {
    const r = resolveActiveSpaceDecision({
      memberships: [
        { space_id: 'spc_a', status: 'active' },
        { space_id: 'spc_b', status: 'active' },
      ],
      cookieSpaceId: undefined,
      querySpaceSlug: undefined,
      queryResolvesToSpaceId: undefined,
      defaultSpaceId: 'spc_a',
    });
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.spaceId).toBe('spc_a');
      expect(r.resolution).toBe('multi_default');
    }
  });

  it('falls back to first active when multi and default missing', () => {
    const r = resolveActiveSpaceDecision({
      memberships: [
        { space_id: 'spc_a', status: 'active' },
        { space_id: 'spc_b', status: 'active' },
      ],
      cookieSpaceId: undefined,
      querySpaceSlug: undefined,
      queryResolvesToSpaceId: undefined,
      defaultSpaceId: undefined,
    });
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.spaceId).toBe('spc_a');
      expect(r.resolution).toBe('multi_default');
    }
  });
});
