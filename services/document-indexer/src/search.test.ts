import { describe, expect, it } from 'vitest';

import { clampLimit, SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT } from './search.js';

describe('clampLimit', () => {
  it('defaults when unset or not a number', () => {
    expect(clampLimit(undefined)).toBe(SEARCH_DEFAULT_LIMIT);
    expect(clampLimit(Number.NaN)).toBe(SEARCH_DEFAULT_LIMIT);
  });

  it('clamps to a sane band', () => {
    // A caller must not be able to ask for the whole index in one call, nor
    // for zero rows (which the SQL would reject).
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(1000)).toBe(SEARCH_MAX_LIMIT);
    expect(clampLimit(12.7)).toBe(12);
  });
});
