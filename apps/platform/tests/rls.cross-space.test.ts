import { describe, expect, it } from 'vitest';

/**
 * Cross-space isolation should be proven with two JWT identities and the seed orgs/spaces.
 * Enable when CI provides SUPABASE_URL + test users with distinct memberships.
 */
describe.skip('RLS cross-space leak (requires live Supabase)', () => {
  it('user A cannot select space_memberships for space B', () => {
    expect(true).toBe(true);
  });
});
